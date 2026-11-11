import {
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateTokens,
  safetyMarginTokens,
  truncateTextToTokens,
} from "./context.budget.js";
import { resolveContextPolicy, strategyFor } from "./context.policy.js";
import {
  selectHistory,
  selectKnowledge,
  selectMemories,
} from "./context.selector.js";
import type {
  BuildContextInput,
  ContextCitation,
  ContextKnowledgeChunk,
  ContextMemory,
  ContextMessage,
  ContextResult,
  ContextStats,
} from "./context.types.js";

const MEMORY_LABELS: Record<ContextMemory["kind"], string> = {
  fact: "事实",
  preference: "偏好",
  task: "待办",
};

function formatSummary(summary: string): string {
  return [
    "以下是更早对话的摘要（可能有损，仅用于保持上下文连续性，不代表新的用户输入）：",
    summary,
  ].join("\n");
}

function formatMemories(memories: ContextMemory[]): string {
  const lines = memories.map(
    (memory) => `- [${MEMORY_LABELS[memory.kind]}] ${memory.content}`,
  );

  return [
    "以下是关于用户的长期记忆，仅作为参考；如果与当前消息冲突，以当前消息为准：",
    ...lines,
  ].join("\n");
}

function formatKnowledge(chunks: ContextKnowledgeChunk[]): string {
  const sections = chunks.map((chunk, index) => {
    const title = chunk.title?.trim() || chunk.source;
    return `[${index + 1}] 《${title}》（来源：${chunk.source}）\n${chunk.content}`;
  });

  return [
    "以下是从知识库检索到的参考资料，仅供参考，不代表用户当前输入。引用时请标注编号：",
    ...sections,
  ].join("\n\n");
}

function toCitations(chunks: ContextKnowledgeChunk[]): ContextCitation[] {
  return chunks.map((chunk, index) => ({
    index: index + 1,
    id: chunk.id,
    source: chunk.source,
    title: chunk.title,
    snippet: truncateTextToTokens(chunk.content, 120),
    score: chunk.score,
  }));
}

/**
 * 上下文组装入口。
 *
 * 预算分配顺序：
 *   system prompt → 当前消息 → 输出预留 → 安全余量
 *   → 摘要 → 长期记忆 → 知识库 → 最近历史
 *
 * 稳定内容（system prompt）放在最前面，有利于 Prompt 缓存。
 */
export function buildContext(input: BuildContextInput): ContextResult {
  const policy = input.policy ?? resolveContextPolicy();
  const strategy = strategyFor(policy);

  const systemTokens = estimateTokens(policy.systemPrompt) + 4;
  const currentTokens = estimateTokens(input.currentMessage) + 4;
  const safetyTokens = safetyMarginTokens(policy.maxContextTokens);

  let available =
    policy.maxContextTokens -
    policy.reserveOutputTokens -
    systemTokens -
    currentTokens -
    safetyTokens;
  available = Math.max(0, available);

  let summaryText: string | undefined;
  let summaryTokens = 0;
  let summaryTruncated = false;

  if (strategy.includeSummary && input.summary?.trim()) {
    const originalTokens = estimateTokens(input.summary);
    const cap = Math.min(policy.summaryMaxTokens, Math.floor(available * 0.25));

    if (cap > 0) {
      summaryText = truncateTextToTokens(input.summary.trim(), cap);
      summaryTokens = estimateTokens(summaryText) + 8;
      summaryTruncated = originalTokens > cap;
      available = Math.max(0, available - summaryTokens);
    }
  }

  const memoryCap = Math.min(
    Math.floor(policy.maxContextTokens * policy.memoryBudgetRatio),
    Math.floor(available * 0.35),
  );
  const memorySelection = selectMemories(input.memories ?? [], {
    query: input.currentMessage,
    maxTokens: policy.memoryEnabled ? memoryCap : 0,
    limit: policy.memoryLimit,
  });
  available = Math.max(0, available - memorySelection.tokens);

  const knowledgeCap = Math.min(
    Math.floor(policy.maxContextTokens * policy.knowledgeBudgetRatio),
    Math.floor(available * 0.5),
  );
  const knowledgeSelection = selectKnowledge(input.knowledge ?? [], {
    maxTokens: knowledgeCap,
    limit: policy.knowledgeTopK,
  });
  available = Math.max(0, available - knowledgeSelection.tokens);

  const historySelection = selectHistory(input.history, {
    maxTokens: available,
    maxMessages: strategy.maxHistoryMessages(policy),
  });

  const messages: ContextMessage[] = [
    { role: "system", content: policy.systemPrompt },
  ];

  if (summaryText) {
    messages.push({ role: "system", content: formatSummary(summaryText) });
  }
  if (memorySelection.memories.length > 0) {
    messages.push({
      role: "system",
      content: formatMemories(memorySelection.memories),
    });
  }
  if (knowledgeSelection.chunks.length > 0) {
    messages.push({
      role: "system",
      content: formatKnowledge(knowledgeSelection.chunks),
    });
  }

  for (const message of historySelection.messages) {
    messages.push({ role: message.role, content: message.content });
  }
  messages.push({ role: "user", content: input.currentMessage });

  const citations = toCitations(knowledgeSelection.chunks);
  const estimatedTokens = estimateMessagesTokens(messages);

  const stats: ContextStats = {
    strategy: policy.strategy,
    budgetTokens: policy.maxContextTokens,
    estimatedTokens,
    systemTokens,
    summaryTokens,
    memoryTokens: memorySelection.tokens,
    knowledgeTokens: knowledgeSelection.tokens,
    historyTokens: historySelection.tokens,
    currentTokens,
    includedMessages: historySelection.messages.length,
    droppedMessages: historySelection.dropped,
    filteredMessages: historySelection.filtered,
    summaryUsed: Boolean(summaryText),
    memoryUsed: memorySelection.memories.length,
    knowledgeUsed: knowledgeSelection.chunks.length,
    truncated:
      historySelection.dropped > 0 ||
      summaryTruncated ||
      memorySelection.memories.length < (input.memories?.length ?? 0) ||
      knowledgeSelection.chunks.length < (input.knowledge?.length ?? 0),
  };

  return { messages, citations, stats };
}

/** 供日志/调试使用：单条消息的估算 Token。 */
export function estimateContextMessageTokens(message: ContextMessage): number {
  return estimateMessageTokens(message);
}
