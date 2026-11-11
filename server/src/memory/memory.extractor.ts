import { completeChat } from "../ai/chat.js";
import { stripCodeFence, truncateText } from "../lib/text.js";
import type { ExtractedMemory, MemoryKind } from "./memory.types.js";

const EXTRACTION_TIMEOUT_MS = 12_000;
const EXTRACTION_MAX_OUTPUT_TOKENS = 400;
const VALID_KINDS: MemoryKind[] = ["fact", "preference", "task"];

const EXTRACTION_SYSTEM_PROMPT = [
  "你是长期记忆提取器。请从一轮对话中提取值得跨会话保留的信息。",
  "只提取用户明确表达的稳定事实、长期偏好、未完成待办；不要提取一次性问题或助手自己的话。",
  "不要提取密钥、密码、身份证、银行卡等敏感信息；不确定时不要提取。",
  '严格输出 JSON，不要 Markdown 代码块：{"memories":[{"kind":"fact|preference|task","content":"..."}]}',
].join("\n");

function parseMemories(raw: string): ExtractedMemory[] {
  const text = stripCodeFence(raw).trim();
  if (!text) {
    return [];
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }

  if (!data || typeof data !== "object") {
    return [];
  }

  const memories = (data as { memories?: unknown }).memories;
  if (!Array.isArray(memories)) {
    return [];
  }

  const seen = new Set<string>();
  const result: ExtractedMemory[] = [];

  for (const item of memories) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const kind = (item as { kind?: unknown }).kind;
    const content = (item as { content?: unknown }).content;

    if (typeof kind !== "string" || !VALID_KINDS.includes(kind as MemoryKind)) {
      continue;
    }
    if (typeof content !== "string") {
      continue;
    }

    const trimmed = truncateText(content.trim(), 200);
    if (trimmed.length < 2) {
      continue;
    }

    const key = `${kind}:${trimmed}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    result.push({ kind: kind as MemoryKind, content: trimmed });
    if (result.length >= 5) {
      break;
    }
  }

  return result;
}

/** 调用小模型从一轮对话中抽取长期记忆；失败时返回空数组。 */
export async function extractMemories(input: {
  userMessage: string;
  assistantMessage: string;
}): Promise<ExtractedMemory[]> {
  const transcript = truncateText(
    [`用户：${input.userMessage}`, `助手：${input.assistantMessage}`].join(
      "\n\n",
    ),
    3000,
  );

  const result = await completeChat(
    [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: transcript },
    ],
    {
      temperature: 0,
      maxTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
      signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
    },
  );

  return parseMemories(result.content);
}
