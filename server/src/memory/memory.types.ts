/** 长期记忆：跨会话保留的用户事实、偏好与待办。 */

export type MemoryKind = "fact" | "preference" | "task";

export type MemoryEntry = {
  id: string;
  userId: string;
  kind: MemoryKind;
  content: string;
  sourceConversationId?: string;
  createdAt: string;
  updatedAt: string;
};

export type MemorySearchResult = MemoryEntry & {
  score: number;
};

export type ExtractedMemory = {
  kind: MemoryKind;
  content: string;
};
