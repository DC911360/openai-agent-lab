import { env } from "../config/env.js";
import { buildContext } from "../context/context.builder.js";
import { resolveContextPolicy } from "../context/context.policy.js";
import type {
  ContextHistoryMessage,
  ContextPolicy,
  ContextResult,
} from "../context/context.types.js";
import { searchKnowledge } from "../knowledge/knowledge.service.js";
import {
  loadRelevantMemories,
  rememberFromTurn,
  resolveUserId,
} from "../memory/memory.service.js";
import { scheduleSummary } from "./conversation.summary.js";
import {
  appendMessage,
  createConversation,
  getConversation,
} from "./conversation.service.js";
import type {
  ChatInputMessage,
  ConversationMessage,
  ConversationUsage,
} from "./conversation.types.js";

export type PrepareTurnInput =
  | {
      mode: "session";
      conversationId?: string;
      message: string;
      userId?: string;
    }
  | {
      mode: "stateless";
      messages: ChatInputMessage[];
    };

export type PreparedTurn = {
  mode: "session" | "stateless";
  conversationId?: string;
  userId: string;
  userMessage: string;
  context: ContextResult;
  policy: ContextPolicy;
};

export type TurnOutcome = {
  status: "done" | "aborted" | "error";
  content: string;
  usage?: ConversationUsage;
};

function toContextHistory(
  messages: ConversationMessage[],
): ContextHistoryMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    createdAt: message.createdAt,
  }));
}

function statelessHistory(messages: ChatInputMessage[]): ContextHistoryMessage[] {
  const now = new Date().toISOString();

  return messages.map((message, index) => ({
    id: `stateless-${index}`,
    role: message.role,
    content: message.content,
    status: "done",
    createdAt: now,
  }));
}

/**
 * 一次对话的准备工作：
 * 1. 定位/创建会话；
 * 2. 加载长期记忆与知识库；
 * 3. 由 Context Builder 决定本次真正发给模型的内容；
 * 4. 持久化当前 user 消息。
 *
 * stateless 模式（旧版 `{ messages }`）不写会话，但同样经过上下文工程。
 */
export async function prepareTurn(
  input: PrepareTurnInput,
): Promise<PreparedTurn> {
  const policy = resolveContextPolicy();

  if (input.mode === "session") {
    const conversation = input.conversationId
      ? await getConversation(input.conversationId)
      : await createConversation({ userId: input.userId });

    const userId = resolveUserId(input.userId ?? conversation.userId);

    const [memories, knowledge] = await Promise.all([
      loadRelevantMemories({ userId, query: input.message }),
      searchKnowledge(input.message, policy.knowledgeTopK),
    ]);
    const  buildContextParams = {
      history: toContextHistory(conversation.messages),
      currentMessage: input.message,
      summary: conversation.summary,
      memories,
      knowledge,
      policy,
    }
    console.log("buildContextParams=>",buildContextParams)
    const context = buildContext(buildContextParams);

    const savedMessage = await appendMessage(conversation.id, {
      role: "user",
      content: input.message,
      status: "done",
      metadata: { mode: "session" },
    });

    return {
      mode: "session",
      conversationId: conversation.id,
      userId,
      userMessage: savedMessage.content,
      context,
      policy,
    };
  }

  const current = input.messages[input.messages.length - 1]!;
  const history = statelessHistory(input.messages.slice(0, -1));
  const userId = resolveUserId();

  const [memories, knowledge] = await Promise.all([
    loadRelevantMemories({ userId, query: current.content }),
    searchKnowledge(current.content, policy.knowledgeTopK),
  ]);

  const context = buildContext({
    history,
    currentMessage: current.content,
    memories,
    knowledge,
    policy,
  });

  return {
    mode: "stateless",
    userId,
    userMessage: current.content,
    context,
    policy,
  };
}

/** 持久化 assistant 回复；空内容不写入，避免污染历史。 */
export async function finishTurn(
  prepared: PreparedTurn,
  outcome: TurnOutcome,
): Promise<void> {
  if (prepared.mode !== "session" || !prepared.conversationId) {
    return;
  }
  if (!outcome.content.trim()) {
    return;
  }

  await appendMessage(prepared.conversationId, {
    role: "assistant",
    content: outcome.content,
    status: outcome.status,
    usage: outcome.usage,
    model: env.deepseekModel,
  });
}

/**
 * 响应发送后的副作用：
 * - 提取长期记忆（需 MEMORY_ENABLED=true，后台执行）；
 * - 达到阈值时更新会话摘要（后台执行）。
 */
export function afterTurn(
  prepared: PreparedTurn,
  outcome: TurnOutcome,
): void {
  if (outcome.status !== "done") {
    return;
  }

  rememberFromTurn({
    userId: prepared.userId,
    conversationId: prepared.conversationId,
    userMessage: prepared.userMessage,
    assistantMessage: outcome.content,
  });

  if (prepared.mode === "session" && prepared.conversationId) {
    scheduleSummary(prepared.conversationId, prepared.policy);
  }
}
