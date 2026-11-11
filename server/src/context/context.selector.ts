import { scoreTokenOverlap } from "../lib/text.js";
import {
  MESSAGE_TOKEN_OVERHEAD,
  estimateTokens,
  truncateTextToTokens,
} from "./context.budget.js";
import type {
  ContextHistoryMessage,
  ContextKnowledgeChunk,
  ContextMemory,
} from "./context.types.js";

export type HistorySelection = {
  messages: ContextHistoryMessage[];
  tokens: number;
  dropped: number;
  filtered: number;
};

export type HistorySelectionOptions = {
  maxTokens: number;
  maxMessages: number;
};

/**
 * 把历史按「轮」分组：一条 user 开启一组，后续 assistant 归入该组。
 * 开头没有对应 user 的 assistant 会被忽略，避免出现孤儿消息。
 */
function groupIntoTurns(
  messages: ContextHistoryMessage[],
): ContextHistoryMessage[][] {
  const turns: ContextHistoryMessage[][] = [];

  for (const message of messages) {
    if (message.role === "user") {
      turns.push([message]);
      continue;
    }

    const currentTurn = turns[turns.length - 1];
    if (currentTurn) {
      currentTurn.push(message);
    }
  }

  return turns;
}

/**
 * 从新到旧选择完整轮次：
 * - 只纳入 status=done 且内容非空的消息；
 * - 一旦某一轮超出剩余预算就停止，保证历史连续；
 * - 返回结果按时间正序排列。
 */
export function selectHistory(
  history: ContextHistoryMessage[],
  options: HistorySelectionOptions,
): HistorySelection {
  const eligible = history.filter(
    (message) => message.status === "done" && message.content.trim().length > 0,
  );
  const filtered = history.length - eligible.length;
  const turns = groupIntoTurns(eligible);

  const selected: ContextHistoryMessage[] = [];
  let tokens = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const turnTokens = turn.reduce(
      (total, message) =>
        total + estimateTokens(message.content) + MESSAGE_TOKEN_OVERHEAD,
      0,
    );

    if (selected.length + turn.length > options.maxMessages) {
      break;
    }
    if (tokens + turnTokens > options.maxTokens) {
      break;
    }

    selected.unshift(...turn);
    tokens += turnTokens;
  }

  return {
    messages: selected,
    tokens,
    dropped: eligible.length - selected.length,
    filtered,
  };
}

export type MemorySelection = {
  memories: ContextMemory[];
  tokens: number;
};

export type MemorySelectionOptions = {
  query: string;
  maxTokens: number;
  limit: number;
};

/** 按查询相关度 + 更新时间排序，并在预算内截断。 */
export function selectMemories(
  memories: ContextMemory[],
  options: MemorySelectionOptions,
): MemorySelection {
  if (options.maxTokens <= 0 || options.limit <= 0) {
    return { memories: [], tokens: 0 };
  }

  const ranked = memories
    .map((memory) => ({
      ...memory,
      score:
        (memory.score ?? 0) +
        scoreTokenOverlap(options.query, memory.content),
    }))
    .sort(
      (a, b) =>
        (b.score ?? 0) - (a.score ?? 0) ||
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    );

  const selected: ContextMemory[] = [];
  let tokens = 0;

  for (const memory of ranked) {
    if (selected.length >= options.limit) {
      break;
    }

    const remaining = options.maxTokens - tokens;
    if (remaining <= 16) {
      break;
    }

    const content = truncateTextToTokens(
      memory.content,
      Math.max(8, remaining - MESSAGE_TOKEN_OVERHEAD),
    );
    if (!content.trim()) {
      continue;
    }

    const cost = estimateTokens(content) + MESSAGE_TOKEN_OVERHEAD;
    if (cost > remaining) {
      continue;
    }

    selected.push({ ...memory, content });
    tokens += cost;
  }

  return { memories: selected, tokens };
}

export type KnowledgeSelection = {
  chunks: ContextKnowledgeChunk[];
  tokens: number;
};

export type KnowledgeSelectionOptions = {
  maxTokens: number;
  limit: number;
};

/** 知识分块已由检索器按相关度排好序，这里只做预算裁剪。 */
export function selectKnowledge(
  chunks: ContextKnowledgeChunk[],
  options: KnowledgeSelectionOptions,
): KnowledgeSelection {
  if (options.maxTokens <= 0 || options.limit <= 0) {
    return { chunks: [], tokens: 0 };
  }

  const ranked = [...chunks].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const selected: ContextKnowledgeChunk[] = [];
  let tokens = 0;

  for (const chunk of ranked) {
    if (selected.length >= options.limit) {
      break;
    }

    const remaining = options.maxTokens - tokens;
    if (remaining <= 32) {
      break;
    }

    // 预留编号、标题、来源等引用头的开销
    const content = truncateTextToTokens(chunk.content, remaining - 24);
    if (!content.trim()) {
      continue;
    }

    const cost = estimateTokens(content) + 24;
    if (cost > remaining) {
      continue;
    }

    selected.push({ ...chunk, content });
    tokens += cost;
  }

  return { chunks: selected, tokens };
}
