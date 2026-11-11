/** 上下文工程的类型定义：输入、策略、预算统计、最终消息与引用。 */

export type ContextStrategyName = "full" | "window" | "summary-window";

export type ContextRole = "system" | "user" | "assistant";

export type ContextMessage = {
  role: ContextRole;
  content: string;
};

export type ContextHistoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "done" | "aborted" | "error";
  createdAt: string;
};

export type ContextMemoryKind = "fact" | "preference" | "task";

export type ContextMemory = {
  id: string;
  kind: ContextMemoryKind;
  content: string;
  updatedAt?: string;
  score?: number;
};

export type ContextKnowledgeChunk = {
  id: string;
  source: string;
  title?: string;
  content: string;
  score?: number;
};

export type ContextCitation = {
  index: number;
  id: string;
  source: string;
  title?: string;
  snippet: string;
  score?: number;
};

export type ContextPolicy = {
  strategy: ContextStrategyName;
  systemPrompt: string;

  /** 模型上下文窗口预算（输入 + 输出） */
  maxContextTokens: number;
  /** 最多纳入多少条历史消息（full 策略忽略此值） */
  maxHistoryMessages: number;
  /** 为模型输出预留的 Token */
  reserveOutputTokens: number;

  /** 历史占用达到预算的多少比例时触发摘要 */
  summaryThreshold: number;
  /** 摘要时保留最近多少轮原文 */
  summaryKeepTurns: number;
  /** 摘要自身的 Token 上限 */
  summaryMaxTokens: number;

  memoryEnabled: boolean;
  memoryLimit: number;
  memoryBudgetRatio: number;

  knowledgeTopK: number;
  knowledgeBudgetRatio: number;
};

export type ContextStats = {
  strategy: ContextStrategyName;
  budgetTokens: number;
  estimatedTokens: number;
  systemTokens: number;
  summaryTokens: number;
  memoryTokens: number;
  knowledgeTokens: number;
  historyTokens: number;
  currentTokens: number;

  includedMessages: number;
  droppedMessages: number;
  filteredMessages: number;

  summaryUsed: boolean;
  memoryUsed: number;
  knowledgeUsed: number;
  truncated: boolean;
};

export type BuildContextInput = {
  history: ContextHistoryMessage[];
  currentMessage: string;
  summary?: string;
  memories?: ContextMemory[];
  knowledge?: ContextKnowledgeChunk[];
  policy?: ContextPolicy;
};

export type ContextResult = {
  messages: ContextMessage[];
  citations: ContextCitation[];
  stats: ContextStats;
};

/**
 * 上下文策略只决定「是否使用摘要」和「历史条数上限」，
 * 具体的预算分配与裁剪由 context.builder.ts 统一执行。
 */
export type ContextStrategy = {
  name: ContextStrategyName;
  includeSummary: boolean;
  maxHistoryMessages: (policy: ContextPolicy) => number;
};
