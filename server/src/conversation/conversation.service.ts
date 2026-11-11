import { randomUUID } from "node:crypto";
import { NotFoundError } from "../lib/errors.js";
import { conversationRepository } from "./conversation.repository.js";
import type {
  AppendMessageInput,
  Conversation,
  ConversationMessage,
  ConversationSummary,
  CreateConversationInput,
} from "./conversation.types.js";

export async function createConversation(
  input: CreateConversationInput = {},
): Promise<Conversation> {
  return conversationRepository.create(input);
}

export async function findConversation(
  id: string,
): Promise<Conversation | null> {
  return conversationRepository.get(id);
}

export async function getConversation(id: string): Promise<Conversation> {
  const conversation = await conversationRepository.get(id);
  if (!conversation) {
    throw new NotFoundError(`会话不存在：${id}`);
  }
  return conversation;
}

export async function listConversations(options: {
  userId?: string;
  limit: number;
}): Promise<ConversationSummary[]> {
  return conversationRepository.list(options);
}

export async function deleteConversation(id: string): Promise<void> {
  const deleted = await conversationRepository.delete(id);
  if (!deleted) {
    throw new NotFoundError(`会话不存在：${id}`);
  }
}

export async function renameConversation(
  id: string,
  title: string,
): Promise<Conversation> {
  const updated = await conversationRepository.update(id, { title });
  if (!updated) {
    throw new NotFoundError(`会话不存在：${id}`);
  }
  return updated;
}

export async function appendMessage(
  id: string,
  input: AppendMessageInput,
): Promise<ConversationMessage> {
  const message: ConversationMessage = {
    id: randomUUID(),
    role: input.role,
    content: input.content,
    status: input.status,
    createdAt: new Date().toISOString(),
    usage: input.usage,
    model: input.model,
    metadata: input.metadata,
  };

  const conversation = await conversationRepository.appendMessage(id, message);
  if (!conversation) {
    throw new NotFoundError(`会话不存在：${id}`);
  }

  return message;
}

export async function updateSummary(
  id: string,
  summary: string,
  upToMessageId: string,
): Promise<void> {
  const updated = await conversationRepository.update(id, {
    summary,
    summaryUpToMessageId: upToMessageId,
    summaryUpdatedAt: new Date().toISOString(),
  });

  if (!updated) {
    throw new NotFoundError(`会话不存在：${id}`);
  }
}

export async function conversationCount(): Promise<number> {
  return conversationRepository.count();
}
