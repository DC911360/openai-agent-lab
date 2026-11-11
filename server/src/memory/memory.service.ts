import { env } from "../config/env.js";
import type { ContextMemory } from "../context/context.types.js";
import { errorMessage } from "../lib/text.js";
import { extractMemories } from "./memory.extractor.js";
import { memoryStore } from "./memory.store.js";

const DEFAULT_USER_ID = "anonymous";

export function resolveUserId(userId?: string): string {
  return userId?.trim() || DEFAULT_USER_ID;
}

/** 按当前问题召回相关长期记忆；未启用时返回空数组。 */
export async function loadRelevantMemories(input: {
  userId: string;
  query: string;
}): Promise<ContextMemory[]> {
  if (!env.context.memoryEnabled) {
    return [];
  }

  return memoryStore
    .search(input.userId, input.query, env.context.memoryLimit)
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      content: entry.content,
      updatedAt: entry.updatedAt,
      score: entry.score,
    }));
}

/**
 * 一轮对话成功后，后台提取长期记忆。
 * 默认关闭，避免每轮多一次模型调用；设置 MEMORY_ENABLED=true 开启。
 */
export function rememberFromTurn(input: {
  userId: string;
  conversationId?: string;
  userMessage: string;
  assistantMessage: string;
}): void {
  if (!env.context.memoryEnabled) {
    return;
  }
  if (!input.userMessage.trim() || !input.assistantMessage.trim()) {
    return;
  }

  void (async () => {
    try {
      const extracted = await extractMemories({
        userMessage: input.userMessage,
        assistantMessage: input.assistantMessage,
      });

      for (const memory of extracted) {
        memoryStore.upsert({
          userId: input.userId,
          kind: memory.kind,
          content: memory.content,
          sourceConversationId: input.conversationId,
        });
      }

      if (extracted.length > 0) {
        console.log(
          `[memory] ${input.userId} 提取到 ${extracted.length} 条长期记忆`,
        );
      }
    } catch (error) {
      console.warn(
        `[memory] 记忆提取失败：${errorMessage(error)}`,
      );
    }
  })();
}
