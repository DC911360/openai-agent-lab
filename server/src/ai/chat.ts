import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { env } from "../config/env.js";
import { aiClient } from "./client.js";
import { assembleToolCalls, ToolCallChunk } from "./assembleToolCalls.js";
import { writeStreamLog } from "./stream-chunk-log.js";
import {
  getAllToolDefinitions,
  executeUnifiedTool,
} from "../tools/tool-runtime.js";
import type { 
  LlmCompletionResult,
  LlmMessage,
  LlmRequestOptions,
  LlmStreamEvent,
  LlmToolCall,
  LlmUsage,
} from "./ai.types.js";

function toApiMessages(
  messages: LlmMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map(
    (message): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
      switch (message.role) {
        case "tool":
          return {
            role: "tool",
            content: message.content,
            tool_call_id: message.tool_call_id ?? "",
          };
        case "assistant":
          return message.tool_calls?.length
            ? {
                role: "assistant",
                content: message.content || null,
                tool_calls: message.tool_calls,
              }
            : { role: "assistant", content: message.content };
        case "user":
          return { role: "user", content: message.content };
        case "system":
          return { role: "system", content: message.content };
      }
    },
  );
}

function toUsage(
  usage: OpenAI.CompletionUsage | null | undefined,
): LlmUsage | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  };
}

function toRequestParams(options: LlmRequestOptions) {
  return {
    model: options.model ?? env.deepseekModel,
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options.maxTokens !== undefined
      ? { max_tokens: options.maxTokens }
      : {}),
  };
}

/** 执行模型请求的工具调用，返回作为 tool 消息正文的文本。 */
async function executeToolCall(toolCall: LlmToolCall): Promise<string> {
  const { name } = toolCall.function;

  // executeUnifiedTool 内部会区分 Local Tool / MCP Tool，
  // 出错时返回 isError 结果交给模型，而不是抛异常
  const result = await executeUnifiedTool(toolCall);

  console.log(`[tool] ${name} 执行完成`, result.slice(0, 200));

  return result;
}

/** 非流式调用：用于摘要、记忆提取，以及 `stream: false` 的聊天请求。 */
export async function completeChat(
  messages: LlmMessage[],
  options: LlmRequestOptions = {},
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
): Promise<LlmCompletionResult> {
  const completion = await aiClient.chat.completions.create(
    {
      ...toRequestParams(options),
      messages: toApiMessages(messages),
      // tools: tools ?? getToolDefinitions(),
      tools: tools ?? getAllToolDefinitions(),
      stream: false,
    },
    { signal: options.signal },
  );
  const choice = completion.choices[0];

  return {
    content: choice?.message?.content ?? "",
    finishReason: choice?.finish_reason ?? null,
    usage: toUsage(completion.usage),
  };
}

/** 流式调用：只产出协议无关的 delta / usage 事件。 */
export async function* streamChat(
  messages: LlmMessage[],
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
  options: LlmRequestOptions = {},
): AsyncGenerator<LlmStreamEvent> {
  const traceId = options.trace?.requestId ?? randomUUID();

  writeStreamLog({
    type: "user",
    traceId,
    requestId: options.trace?.requestId,
    conversationId: options.trace?.conversationId,
    userId: options.trace?.userId,
    message: options.trace?.userMessage ?? "",
  });

  let round = 0;

  while (true) {
    const roundIndex = round;
    round += 1;

    const requestParams = toRequestParams(options);
    // const toolDefinitions = tools ?? getToolDefinitions();
    const toolDefinitions = tools ?? getAllToolDefinitions();

    const requestPayload: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming =
      {
        ...requestParams,
        messages: toApiMessages(messages),
        ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
        stream: true,
        stream_options: { include_usage: true },
      };

    // 调试用：记录发给模型的完整请求体（system prompt、messages、tools、参数）
    writeStreamLog({
      type: "model_request",
      traceId,
      round: roundIndex,
      request: requestPayload,
    });

    console.log(`[model] 第 ${roundIndex + 1} 轮请求模型`, {
      model: requestParams.model,
      messages: messages.length,
      tools: toolDefinitions.map((tool) =>
        tool.type === "function" ? tool.function.name : tool.custom.name,
      ),
    });

    const stream = await aiClient.chat.completions.create(requestPayload, {
      signal: options.signal,
    });

    let finishReason: string | null = null;
    let roundContent = "";
    let roundUsage: LlmUsage | undefined;
    const chunks: unknown[] = [];
    const toolCallChunks: ToolCallChunk[] = [];
    let chunkCount = 0;

    // 调试用：create() 返回的是可迭代的 Stream 对象，真正的数据结构在每次迭代的 chunk 里
    console.log("[stream] create() 返回", {
      constructor: stream.constructor?.name,
      keys: Object.keys(stream),
    });

    for await (const chunk of stream) {
      const chunkIndex = chunkCount;
      chunkCount += 1;

      // 调试用：先收集本轮全部 chunk，结束后聚合成一条 model_response 落盘
      chunks.push(chunk);

      const choice = chunk.choices[0];
      const delta = choice?.delta;

      // 调试用：打印 chunk 的全部内容（不做任何字段筛选）
      // console.log(`[stream] chunk#${chunkIndex}`);
      // console.dir(chunk, { depth: null });

      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }

      if (delta?.tool_calls) {
        toolCallChunks.push(...delta.tool_calls);
      }

      const content = choice?.delta?.content;
      if (content) {
        roundContent += content;
        yield { type: "delta", content };
      }

      const usage = toUsage(chunk.usage);
      if (usage) {
        roundUsage = usage;
        yield { type: "usage", usage };
      }
    }

    console.log("[stream] 本轮结束", {
      chunkCount,
      finishReason,
      toolCallChunkCount: toolCallChunks.length,
    });

    writeStreamLog({
      type: "model_response",
      traceId,
      round: roundIndex,
      model: requestParams.model,
      finishReason,
      content: roundContent,
      usage: roundUsage,
      chunks,
    });

    // stop / length / null 等都直接结束，避免没有工具调用时陷入死循环
    if (finishReason !== "tool_calls") {
      return;
    }

    // 调试用：组装前的原始 tool_call chunks（参数是分片字符串）
    // console.log(
    //   "[stream] 工具调用 chunks 汇总",
    //   JSON.stringify(toolCallChunks, null, 2),
    // );

    const toolCalls = assembleToolCalls(toolCallChunks);

    writeStreamLog({
      type: "tool_call",
      traceId,
      round: roundIndex,
      toolCalls,
    });

    // 调试用：拼接完成的完整工具调用（arguments 已还原为字符串）
    console.log(
      "[stream] 组装后的 toolCalls",
      JSON.stringify(toolCalls, null, 2), 
    );

    // 把模型发出的工具调用和本地执行结果追加进上下文，下一轮交给模型继续生成
    messages.push({ role: "assistant", content: "", tool_calls: toolCalls });

    for (const toolCall of toolCalls) {
      console.log(
        `[tool] ${toolCall.function.name} 开始执行`,
        toolCall.function.arguments,
      );

      writeStreamLog({
        type: "tool_execute",
        traceId,
        round: roundIndex,
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      });

      const toolResult = await executeToolCall(toolCall);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult,
      });

      writeStreamLog({
        type: "tool_result",
        traceId,
        round: roundIndex,
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        content: toolResult,
      });
    }
  }
}
