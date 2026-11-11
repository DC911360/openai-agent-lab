import { env } from "../config/env.js";
import type {
  ContextPolicy,
  ContextStrategy,
  ContextStrategyName,
} from "./context.types.js";

export const DEFAULT_SYSTEM_PROMPT = [
  "你是一名专业的前端技术导师。",
  "回答要准确、简洁、可执行；涉及代码时给出关键片段并解释原因。",
  "如果参考资料与问题无关，不要强行引用。",
].join("\n");

export const CONTEXT_STRATEGIES: Record<ContextStrategyName, ContextStrategy> = {
  full: {
    name: "full",
    includeSummary: false,
    maxHistoryMessages: () => Number.MAX_SAFE_INTEGER,
  },
  window: {
    name: "window",
    includeSummary: false,
    maxHistoryMessages: (policy) => policy.maxHistoryMessages,
  },
  "summary-window": {
    name: "summary-window",
    includeSummary: true,
    maxHistoryMessages: (policy) => policy.maxHistoryMessages,
  },
};

export function resolveContextPolicy(
  overrides: Partial<ContextPolicy> = {},
): ContextPolicy {
  const config = env.context;

  return {
    strategy: overrides.strategy ?? config.strategy,
    systemPrompt:
      overrides.systemPrompt ??
      (env.contextSystemPrompt || DEFAULT_SYSTEM_PROMPT),
    maxContextTokens: overrides.maxContextTokens ?? config.maxTokens,
    maxHistoryMessages:
      overrides.maxHistoryMessages ?? config.maxHistoryMessages,
    reserveOutputTokens:
      overrides.reserveOutputTokens ?? config.reserveOutputTokens,
    summaryThreshold: overrides.summaryThreshold ?? config.summaryThreshold,
    summaryKeepTurns: overrides.summaryKeepTurns ?? config.summaryKeepTurns,
    summaryMaxTokens: overrides.summaryMaxTokens ?? config.summaryMaxTokens,
    memoryEnabled: overrides.memoryEnabled ?? config.memoryEnabled,
    memoryLimit: overrides.memoryLimit ?? config.memoryLimit,
    memoryBudgetRatio:
      overrides.memoryBudgetRatio ?? config.memoryBudgetRatio,
    knowledgeTopK: overrides.knowledgeTopK ?? config.knowledgeTopK,
    knowledgeBudgetRatio:
      overrides.knowledgeBudgetRatio ?? config.knowledgeBudgetRatio,
  };
}

export function strategyFor(policy: ContextPolicy): ContextStrategy {
  return CONTEXT_STRATEGIES[policy.strategy];
}
