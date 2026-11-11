/** 跨模块复用的纯文本工具：归一化、分词、重叠打分、截断。 */

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * 轻量分词：
 * - 英文/数字按单词切分；
 * - 中文按「二元组」切分（“上下文管理” → 上下、下文、文管、管理），
 *   单字成词时保留单字。
 *
 * 这不是严格的分词器，但足够支撑记忆检索与知识库 BM25 的演示。
 */
export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  const tokens: string[] = [];

  const latinWords = normalized.match(/[a-z0-9_]+/g);
  if (latinWords) {
    tokens.push(...latinWords);
  }

  const cjkRuns = normalized.match(/[㐀-䶿一-鿿]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2));
    }
  }

  return tokens;
}

/** 查询词与文本的简单重叠得分，用于长期记忆排序。 */
export function scoreTokenOverlap(query: string, content: string): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) {
    return 0;
  }

  const contentTokens = new Set(tokenize(content));
  let score = 0;
  for (const token of queryTokens) {
    if (!contentTokens.has(token)) {
      continue;
    }
    score += token.length >= 2 ? 1 : 0.5;
  }
  return score;
}

export function truncateText(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** 去掉模型偶尔返回的 ```json 代码围栏。 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  return match?.[1]?.trim() ?? trimmed;
}

/** 把任意错误转成可读字符串。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
