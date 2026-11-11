import { randomUUID } from "node:crypto";
import { normalizeText, scoreTokenOverlap } from "../lib/text.js";
import type {
  MemoryEntry,
  MemorySearchResult,
  MemoryKind,
} from "./memory.types.js";

const MAX_MEMORIES_PER_USER = 200;

export type MemoryUpsertInput = {
  userId: string;
  kind: MemoryKind;
  content: string;
  sourceConversationId?: string;
};

export interface MemoryStore {
  upsert(input: MemoryUpsertInput): MemoryEntry;
  list(userId: string): MemoryEntry[];
  search(userId: string, query: string, limit: number): MemorySearchResult[];
  remove(id: string): boolean;
  clear(): void;
}

/**
 * 内存版长期记忆：
 * - 同一用户 + 同类型 + 文本归一化后相同，视为同一条记忆并更新时间；
 * - 搜索使用轻量词重叠打分，未来可替换为向量检索。
 */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly byUser = new Map<string, Map<string, MemoryEntry>>();

  upsert(input: MemoryUpsertInput): MemoryEntry {
    const userMemories = this.getUserMap(input.userId);
    const now = new Date().toISOString();
    const normalized = normalizeText(input.content);

    for (const existing of userMemories.values()) {
      if (
        existing.kind === input.kind &&
        normalizeText(existing.content) === normalized
      ) {
        existing.content = input.content;
        existing.updatedAt = now;
        existing.sourceConversationId =
          input.sourceConversationId ?? existing.sourceConversationId;
        return { ...existing };
      }
    }

    const entry: MemoryEntry = {
      id: randomUUID(),
      userId: input.userId,
      kind: input.kind,
      content: input.content,
      sourceConversationId: input.sourceConversationId,
      createdAt: now,
      updatedAt: now,
    };

    userMemories.set(entry.id, entry);
    this.pruneUser(input.userId);

    return { ...entry };
  }

  list(userId: string): MemoryEntry[] {
    return [...this.getUserMap(userId).values()].map((entry) => ({
      ...entry,
    }));
  }

  search(userId: string, query: string, limit: number): MemorySearchResult[] {
    if (limit <= 0) {
      return [];
    }

    return [...this.getUserMap(userId).values()]
      .map((entry) => ({
        ...entry,
        score: scoreTokenOverlap(query, entry.content),
      }))
      .sort(
        (a, b) =>
          b.score - a.score || b.updatedAt.localeCompare(a.updatedAt),
      )
      .slice(0, limit);
  }

  remove(id: string): boolean {
    for (const userMemories of this.byUser.values()) {
      if (userMemories.delete(id)) {
        return true;
      }
    }
    return false;
  }

  clear(): void {
    this.byUser.clear();
  }

  private getUserMap(userId: string): Map<string, MemoryEntry> {
    let userMemories = this.byUser.get(userId);
    if (!userMemories) {
      userMemories = new Map();
      this.byUser.set(userId, userMemories);
    }
    return userMemories;
  }

  private pruneUser(userId: string): void {
    const userMemories = this.byUser.get(userId);
    if (!userMemories || userMemories.size <= MAX_MEMORIES_PER_USER) {
      return;
    }

    let oldestId: string | undefined;
    let oldestUpdatedAt = "";

    for (const [id, entry] of userMemories) {
      if (!oldestId || entry.updatedAt.localeCompare(oldestUpdatedAt) < 0) {
        oldestId = id;
        oldestUpdatedAt = entry.updatedAt;
      }
    }

    if (oldestId) {
      userMemories.delete(oldestId);
      console.warn(`[memory] ${userId} 记忆数超过上限，已淘汰最旧一条`);
    }
  }
}

export const memoryStore = new InMemoryMemoryStore();
