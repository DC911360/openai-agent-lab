import { completeChat } from "../ai/chat.js";
import {
  estimateTokens,
  truncateTextToTokens,
} from "../context/context.budget.js";
import {
  resolveContextPolicy,
  strategyFor,
} from "../context/context.policy.js";
import type { ContextPolicy } from "../context/context.types.js";
import { errorMessage, stripCodeFence } from "../lib/text.js";
import { findConversation, updateSummary } from "./conversation.service.js";
import type { Conversation, ConversationMessage } from "./conversation.types.js";

const SUMMARY_TIMEOUT_MS = 20_000;
const SUMMARY_MAX_OUTPUT_TOKENS = 700;
const SUMMARY_MAX_INPUT_TOKENS = 3000;

const SUMMARY_SYSTEM_PROMPT = [
  "你是对话摘要器。请把「已有摘要」和「新增对话」合并成一份简洁、稳定、可供后续对话使用的中文摘要。",
  "只保留长期有用的信息：用户目标、稳定事实、偏好、约束、关键决策、未完成事项。",
  "不要保留寒暄、重复内容、模型猜测，也不要编造对话中没有的信息。",
  "严格输出 JSON，不要 Markdown 代码块，格式：",
  '{"facts":[],"preferences":[],"constraints":[],"openTasks":[],"decisions":[]}',
].join("\n");

// 同一会话的摘要任务串行化，避免并发重复调用模型
const summaryLocks = new Set<string>();

function collectSummarizableMessages(
  conversation: Conversation,
  policy: ContextPolicy,
): ConversationMessage[] {
  const done = conversation.messages.filter(
    (message) => message.status === "done" && message.content.trim().length > 0,
  );

  let startIndex = 0;
  if (conversation.summaryUpToMessageId) {
    const coveredIndex = done.findIndex(
      (message) => message.id === conversation.summaryUpToMessageId,
    );
    startIndex = coveredIndex >= 0 ? coveredIndex + 1 : 0;
  }

  const remaining = done.slice(startIndex);
  const keepMessages = Math.max(0, policy.summaryKeepTurns * 2);

  return remaining.slice(0, Math.max(0, remaining.length - keepMessages));
}

export function shouldSummarize(
  conversation: Conversation,
  policy: ContextPolicy,
): boolean {
  const done = conversation.messages.filter(
    (message) => message.status === "done" && message.content.trim().length > 0,
  );
  if (done.length === 0) {
    return false;
  }

  const totalTokens = done.reduce(
    (total, message) => total + estimateTokens(message.content) + 4,
    0,
  );
  if (totalTokens < policy.maxContextTokens * policy.summaryThreshold) {
    return false;
  }

  return collectSummarizableMessages(conversation, policy).length >= 2;
}

function formatTranscript(messages: ConversationMessage[]): string {
  const transcript = messages
    .map((message) => `[${message.role}] ${message.content}`)
    .join("\n\n");

  return truncateTextToTokens(transcript, SUMMARY_MAX_INPUT_TOKENS);
}

function renderSummary(raw: string): string {
  const text = stripCodeFence(raw).trim();
  if (!text) {
    return "";
  }

  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const sections: Array<[key: string, label: string]> = [
      ["facts", "事实"],
      ["preferences", "用户偏好"],
      ["constraints", "约束"],
      ["openTasks", "未完成事项"],
      ["decisions", "关键决策"],
    ];

    const lines: string[] = [];
    for (const [key, label] of sections) {
      const value = data[key];
      if (!Array.isArray(value)) {
        continue;
      }

      const items = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => `- ${item}`);

      if (items.length > 0) {
        lines.push(`【${label}】`, ...items);
      }
    }

    if (lines.length > 0) {
      return lines.join("\n");
    }
  } catch {
    // 模型没有严格输出 JSON 时，退化为纯文本摘要
  }

  return truncateTextToTokens(text, 1200);
}

/** 达到阈值时生成/更新滚动摘要；失败不阻塞对话，下一轮会重试。 */
export async function summarizeIfNeeded(
  conversationId: string,
  policy: ContextPolicy = resolveContextPolicy(),
): Promise<void> {
  // 只有摘要策略才需要生成摘要；window/full 模式不白跑模型
  if (!strategyFor(policy).includeSummary) {
    return;
  }

  if (summaryLocks.has(conversationId)) {
    return;
  }

  const conversation = await findConversation(conversationId);
  if (!conversation || !shouldSummarize(conversation, policy)) {
    return;
  }

  summaryLocks.add(conversationId);

  try {
    const messages = collectSummarizableMessages(conversation, policy);
    if (messages.length < 2) {
      return;
    }

    const result = await completeChat(
      [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `已有摘要：\n${conversation.summary ?? "（无）"}`,
            `新增对话：\n${formatTranscript(messages)}`,
          ].join("\n\n"),
        },
      ],
      {
        temperature: 0.2,
        maxTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
      },
    );

    const summary = renderSummary(result.content);
    if (!summary) {
      return;
    }

    const upToMessageId = messages[messages.length - 1]!.id;
    await updateSummary(conversationId, summary, upToMessageId);

    console.log(`[summary] ${conversationId} 摘要已更新`, {
      summarizedMessages: messages.length,
      summaryTokens: estimateTokens(summary),
      upToMessageId,
    });
  } catch (error) {
    console.warn(
      `[summary] ${conversationId} 摘要生成失败，将在后续轮次重试：${errorMessage(error)}`,
    );
  } finally {
    summaryLocks.delete(conversationId);
  }
}

/** 后台触发摘要，不阻塞本次响应。 */
export function scheduleSummary(
  conversationId: string,
  policy?: ContextPolicy,
): void {
  void summarizeIfNeeded(conversationId, policy);
}
