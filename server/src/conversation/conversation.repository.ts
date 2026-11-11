import { randomUUID } from "node:crypto";
import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
  CreateConversationInput,
} from "./conversation.types.js";

const MAX_CONVERSATIONS = 200;
const DEFAULT_TITLE = "新会话";
const TITLE_MAX_CHARS = 30;

export type ConversationPatch = Partial<
  Pick<
    Conversation,
    "title" | "summary" | "summaryUpToMessageId" | "summaryUpdatedAt"
  >
>;

/**
 * Repository 接口刻意设计为异步：
 * 当前是内存实现，未来换成 SQLite/Redis 时上层代码不需要改。
 */
export interface ConversationRepository {
  create(input: CreateConversationInput): Promise<Conversation>;
  get(id: string): Promise<Conversation | null>;
  list(options: { userId?: string; limit: number }): Promise<ConversationSummary[]>;
  update(id: string, patch: ConversationPatch): Promise<Conversation | null>;
  appendMessage(
    id: string,
    message: ConversationMessage,
  ): Promise<Conversation | null>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly conversations = new Map<string, Conversation>();

  async create(input: CreateConversationInput): Promise<Conversation> {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      userId: input.userId,
      title: input.title?.trim() || DEFAULT_TITLE,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
      messages: [],
    };

    this.conversations.set(conversation.id, conversation);
    this.evictIfNeeded();

    return structuredClone(conversation);
  }

  async get(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.get(id);
    return conversation ? structuredClone(conversation) : null;
  }

  async list(options: {
    userId?: string;
    limit: number;
  }): Promise<ConversationSummary[]> {
    return [...this.conversations.values()]
      .filter(
        (conversation) =>
          !options.userId || conversation.userId === options.userId,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, options.limit)
      .map((conversation) => this.toSummary(conversation));
  }

  async update(
    id: string,
    patch: ConversationPatch,
  ): Promise<Conversation | null> {
    const conversation = this.conversations.get(id);
    if (!conversation) {
      return null;
    }

    Object.assign(conversation, patch);
    conversation.updatedAt = new Date().toISOString();
    return structuredClone(conversation);
  }

  async appendMessage(
    id: string,
    message: ConversationMessage,
  ): Promise<Conversation | null> {
    const conversation = this.conversations.get(id);
    if (!conversation) {
      return null;
    }

    conversation.messages.push(message);
    conversation.updatedAt = message.createdAt;

    if (conversation.title === DEFAULT_TITLE && message.role === "user") {
      const title = message.content
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, TITLE_MAX_CHARS);
      if (title) {
        conversation.title = title;
      }
    }

    return structuredClone(conversation);
  }

  async delete(id: string): Promise<boolean> {
    return this.conversations.delete(id);
  }

  async count(): Promise<number> {
    return this.conversations.size;
  }

  async clear(): Promise<void> {
    this.conversations.clear();
  }

  private toSummary(conversation: Conversation): ConversationSummary {
    const last = conversation.messages[conversation.messages.length - 1];

    return {
      id: conversation.id,
      userId: conversation.userId,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      summary: conversation.summary,
      summaryUpdatedAt: conversation.summaryUpdatedAt,
      messageCount: conversation.messages.length,
      lastMessage: last
        ? {
            role: last.role,
            content: last.content.slice(0, 200),
            createdAt: last.createdAt,
          }
        : undefined,
    };
  }

  private evictIfNeeded(): void {
    while (this.conversations.size > MAX_CONVERSATIONS) {
      let oldest: Conversation | undefined;

      for (const conversation of this.conversations.values()) {
        if (
          !oldest ||
          conversation.updatedAt.localeCompare(oldest.updatedAt) < 0
        ) {
          oldest = conversation;
        }
      }

      if (!oldest) {
        break;
      }

      this.conversations.delete(oldest.id);
      console.warn(
        `[conversation] 会话数超过 ${MAX_CONVERSATIONS}，已淘汰最旧会话 ${oldest.id}`,
      );
    }
  }
}

export const conversationRepository = new InMemoryConversationRepository();
