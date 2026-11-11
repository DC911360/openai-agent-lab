import type { ContextMessage } from "./context.types.js";

/** 每条消息的角色、分隔符等结构开销。 */
export const MESSAGE_TOKEN_OVERHEAD = 4;

function isCjkLike(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK 扩展 A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK 基本区
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK 兼容区
    (codePoint >= 0x3000 && codePoint <= 0x303f) || // CJK 标点
    (codePoint >= 0xff00 && codePoint <= 0xffef) // 全角字符
  );
}

/**
 * 保守的 Token 估算：
 * - 中文/CJK 字符约 1 字符 = 1 Token；
 * - 其他字符约 4 字符 = 1 Token；
 * - 额外 +1 作为格式开销。
 *
 * 真实值以模型返回的 usage.prompt_tokens 为准，估算只用于预算裁剪。
 */
export function estimateTokens(text: string): number {
  let cjkCount = 0;
  let otherCount = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (isCjkLike(codePoint)) {
      cjkCount += 1;
    } else {
      otherCount += 1;
    }
  }

  return Math.ceil(cjkCount + otherCount / 4) + 1;
}

export function estimateMessageTokens(message: ContextMessage): number {
  return estimateTokens(message.content) + MESSAGE_TOKEN_OVERHEAD;
}

export function estimateMessagesTokens(messages: ContextMessage[]): number {
  return messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );
}

/** 按 Token 预算截断文本，保留结尾省略号。 */
export function truncateTextToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return "";
  }
  if (estimateTokens(text) <= maxTokens) {
    return text;
  }

  const budget = Math.max(1, maxTokens - 1);
  let low = 0;
  let high = text.length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(text.slice(0, middle)) <= budget) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return `${text.slice(0, low)}…`;
}

/** 防止估算误差导致上下文刚好越过模型窗口。 */
export function safetyMarginTokens(maxContextTokens: number): number {
  return Math.max(32, Math.floor(maxContextTokens * 0.02));
}
