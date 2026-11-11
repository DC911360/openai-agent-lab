import { Router, type Response } from "express";
import { completeChat, streamChat } from "../ai/chat.js";
import type { LlmUsage } from "../ai/ai.types.js";
import { 
  afterTurn,
  finishTurn,
  prepareTurn,
  type PreparedTurn,
  type TurnOutcome,
} from "../conversation/chat.service.js";
import {
  abortActiveRequest,
  registerActiveRequest,
  unregisterActiveRequest,
} from "./active-requests.js";
import { abortChatRequestSchema, chatRequestSchema } from "./chat.schema.js";
import {
  releaseConversationLock,
  tryAcquireConversationLock,
} from "./conversation-locks.js";
import {
  getLogEntry,
  getRequestId,
  preview,
  setJsonLogResponse,
} from "./logger.js";
import type { RequestLog } from "./log.types.js";
import { initSse, sendSse } from "./sse.js";
import { sendValidationError } from "./validation.js";

export const chatRouter = Router();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeFinishTurn(
  prepared: PreparedTurn,
  outcome: TurnOutcome,
): Promise<void> {
  try {
    await finishTurn(prepared, outcome);
  } catch (error) {
    console.error(`[chat] 会话持久化失败：${errorText(error)}`);
  }
}

function recordAbort(
  logEntry: RequestLog | undefined,
  prepared: PreparedTurn,
  content: string,
  chunkCount: number,
  usage: LlmUsage | undefined,
  controller: AbortController,
): void {
  if (!logEntry) {
    return;
  }

  logEntry.response = {
    mode: "stream",
    content,
    chunkCount,
    usage,
    context: prepared.context.stats,
    citations: prepared.context.citations,
  };
  logEntry.aborted = { reason: String(controller.signal.reason) };
}

async function handleJsonResponse(
  res: Response,
  prepared: PreparedTurn,
  controller: AbortController,
  requestId: string,
  logEntry: RequestLog | undefined,
  closedByClient: boolean,
): Promise<void> {
  try {
    const result = await completeChat(prepared.context.messages, {
      signal: controller.signal,
    });

    await safeFinishTurn(prepared, {
      status: "done",
      content: result.content,
      usage: result.usage,
    });

    if (logEntry) {
      logEntry.response = {
        mode: "json",
        content: result.content,
        finishReason: result.finishReason,
        usage: result.usage,
        context: prepared.context.stats,
        citations: prepared.context.citations,
      };
    }

    console.log(`[chat] ${requestId} 响应参数`, {
      mode: "json",
      finishReason: result.finishReason,
      usage: result.usage,
      content: preview(result.content),
    });

    res.json({
      requestId,
      content: result.content,
      finishReason: result.finishReason,
      usage: result.usage,
      conversationId: prepared.conversationId,
      context: prepared.context.stats,
      citations: prepared.context.citations,
    });

    afterTurn(prepared, {
      status: "done",
      content: result.content,
      usage: result.usage,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      await safeFinishTurn(prepared, { status: "aborted", content: "" });

      if (logEntry) {
        logEntry.response = {
          mode: "json",
          content: "",
          context: prepared.context.stats,
          citations: prepared.context.citations,
        };
        logEntry.aborted = { reason: String(controller.signal.reason) };
      }

      if (!closedByClient && !res.headersSent) {
        res.status(499).json({
          error: "请求已被中断",
          requestId,
          conversationId: prepared.conversationId,
        });
      }
      return;
    }

    console.error(`[chat] ${requestId} 模型调用失败：${errorText(error)}`);

    await safeFinishTurn(prepared, { status: "error", content: "" });

    if (logEntry) {
      logEntry.response = {
        mode: "json",
        content: "",
        context: prepared.context.stats,
        citations: prepared.context.citations,
      };
      logEntry.error = errorText(error);
    }

    if (!closedByClient && !res.headersSent) {
      res.status(502).json({ error: "模型调用失败，请稍后重试" });
    }
  }
}

async function handleStreamResponse(
  res: Response,
  prepared: PreparedTurn,
  controller: AbortController,
  requestId: string,
  logEntry: RequestLog | undefined,
  closedByClient: boolean,
): Promise<void> {
  initSse(res);

  let content = "";
  let chunkCount = 0;
  let usage: LlmUsage | undefined;

  try {
    for await (const event of streamChat(
      prepared.context.messages,
      undefined,
      {
        signal: controller.signal,
        trace: {
          requestId,
          conversationId: prepared.conversationId,
          userId: prepared.userId,
          userMessage: prepared.userMessage,
        },
      },
    )) {
      if (event.type === "delta") {
        content += event.content;
        chunkCount += 1;
        sendSse(res, event);
      } else {
        usage = event.usage;
      }
    }

    // SDK 在部分中断场景下会正常结束迭代而不是抛错，这里补一次检查
    if (controller.signal.aborted) {
      await safeFinishTurn(prepared, { status: "aborted", content, usage });
      recordAbort(logEntry, prepared, content, chunkCount, usage, controller);

      if (!closedByClient && !res.writableEnded) {
        sendSse(res, { type: "aborted", message: "生成已中断" });
      }
      return;
    }

    await safeFinishTurn(prepared, { status: "done", content, usage });

    if (logEntry) {
      logEntry.response = {
        mode: "stream",
        content,
        chunkCount,
        usage,
        context: prepared.context.stats,
        citations: prepared.context.citations,
      };
    }

    console.log(`[chat] ${requestId} 响应参数`, {
      mode: "stream",
      chunkCount,
      usage,
      content: preview(content),
    });

    if (!closedByClient && !res.writableEnded) {
      sendSse(res, {
        type: "done",
        requestId,
        usage,
        conversationId: prepared.conversationId,
        context: prepared.context.stats,
        citations: prepared.context.citations,
      });
    }

    afterTurn(prepared, { status: "done", content, usage });
  } catch (error) {
    if (controller.signal.aborted) {
      await safeFinishTurn(prepared, { status: "aborted", content, usage });
      recordAbort(logEntry, prepared, content, chunkCount, usage, controller);

      if (!closedByClient && !res.writableEnded) {
        sendSse(res, { type: "aborted", message: "生成已中断" });
      }
      return;
    }

    console.error(
      `[chat] ${requestId} 流式模型调用失败：${errorText(error)}`,
      { content: preview(content) },
    );

    await safeFinishTurn(prepared, { status: "error", content, usage });

    if (logEntry) {
      logEntry.response = {
        mode: "stream",
        content,
        chunkCount,
        usage,
        context: prepared.context.stats,
        citations: prepared.context.citations,
      };
      logEntry.error = errorText(error);
    }

    if (!closedByClient && !res.writableEnded) {
      sendSse(res, { type: "error", message: "模型调用失败，请稍后重试" });
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}

// 中断接口：按 requestId 中断进行中的普通请求或流式请求
chatRouter.post("/abort", (req, res) => {
  const parsed = abortChatRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    sendValidationError(res, parsed.error.issues);
    return;
  }

  const { requestId } = parsed.data;

  if (!abortActiveRequest(requestId)) {
    const payload = { error: "未找到进行中的请求", requestId };
    setJsonLogResponse(res, payload);
    res.status(404).json(payload);
    return;
  }

  console.log(`[chat] ${requestId} 已收到中断请求`);

  const payload = { ok: true, requestId };
  setJsonLogResponse(res, payload);
  res.json(payload);
});

chatRouter.post("/", async (req, res) => {
  const parsed = chatRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    sendValidationError(res, parsed.error.issues);
    return;
  }

  const input = parsed.data;
  const sessionMode = input.message !== undefined;
  const stream = input.stream;
  const requestId = getRequestId(res);
  const controller = new AbortController();

  if (!registerActiveRequest(requestId, controller)) {
    res.status(409).json({
      error: "requestId 已被占用，请使用新的 requestId",
      requestId,
    });
    return;
  }

  let lockId: string | undefined;

  if (sessionMode && input.conversationId) {
    if (!tryAcquireConversationLock(input.conversationId)) {
      unregisterActiveRequest(requestId);
      const payload = {
        error: "该会话正在生成回复，请稍后再试",
        conversationId: input.conversationId,
        requestId,
      };
      setJsonLogResponse(res, payload);
      res.status(409).json(payload);
      return;
    }
    lockId = input.conversationId;
  }

  let closedByClient = false;
  res.on("close", () => {
    if (!res.writableFinished) {
      closedByClient = true;
      controller.abort("client-close");
    }
  });

  const logEntry = getLogEntry(res);

  if (logEntry) {
    logEntry.chat = {
      mode: sessionMode ? "session" : "stateless",
      conversationId: input.conversationId,
      stream,
      messages: sessionMode
        ? [{ role: "user", content: input.message! }]
        : input.messages!.map(({ role, content }) => ({ role, content })),
    };
  }

  console.log(`[chat] ${requestId} 请求参数`, {
    mode: sessionMode ? "session" : "stateless",
    conversationId: input.conversationId,
    stream,
    message: sessionMode ? preview(input.message!) : undefined,
    messages: sessionMode
      ? undefined
      : input.messages!.map((message) => ({
          role: message.role,
          content: preview(message.content),
        })),
  });

  try {
    const prepared = await prepareTurn(
      sessionMode
        ? {
            mode: "session",
            conversationId: input.conversationId,
            message: input.message!,
            userId: input.userId,
          }
        : { mode: "stateless", messages: input.messages! },
    );

    if (prepared.conversationId) {
      res.setHeader("X-Conversation-Id", prepared.conversationId);
      if (logEntry?.chat) {
        logEntry.chat.conversationId = prepared.conversationId;
      }
    }
    if (logEntry?.chat) {
      logEntry.chat.context = prepared.context.stats;
    }

    console.log(`[context] ${requestId}`, prepared.context.stats);

    if (controller.signal.aborted) {
      const payload = {
        error: "请求已被中断",
        requestId,
        conversationId: prepared.conversationId,
      };
      setJsonLogResponse(res, payload);
      res.status(499).json(payload);
      return;
    }

    if (stream) {
      await handleStreamResponse(
        res,
        prepared,
        controller,
        requestId,
        logEntry,
        closedByClient,
      );
    } else {
      await handleJsonResponse(
        res,
        prepared,
        controller,
        requestId,
        logEntry,
        closedByClient,
      );
    }
  } catch (error) {
    if (logEntry) {
      logEntry.error = errorText(error);
    }

    if (!res.headersSent) {
      throw error;
    }

    console.error(`[chat] ${requestId} 响应阶段异常：${errorText(error)}`);
  } finally {
    unregisterActiveRequest(requestId);
    if (lockId) {
      releaseConversationLock(lockId);
    }
  }
});
