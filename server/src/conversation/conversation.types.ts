/** 会话领域模型：为未来的用户系统、工具调用、持久化预留字段。 */

export type ConversationMessageRole = "user" | "assistant";

export type ConversationMessageStatus = "done" | "aborted" | "error";

export type ConversationUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type ConversationMessage = {
  id: string;
  role: ConversationMessageRole;
  content: string;
  status: ConversationMessageStatus;
  createdAt: string;
  usage?: ConversationUsage;
  model?: string;
  metadata?: Record<string, unknown>;
};

export type Conversation = {
  id: string;
  userId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;

  /** 滚动摘要：只对 summary-window 策略生效 */
  summary?: string;
  /** 摘要已覆盖到的最后一条消息 id，避免重复摘要 */
  summaryUpToMessageId?: string;
  summaryUpdatedAt?: string;

  metadata?: Record<string, unknown>;
  messages: ConversationMessage[];
};

export type ConversationSummary = {
  id: string;
  userId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  summaryUpdatedAt?: string;
  messageCount: number;
  lastMessage?: {
    role: ConversationMessageRole;
    content: string;
    createdAt: string;
  };
};

export type CreateConversationInput = {
  userId?: string;
  title?: string;
  metadata?: Record<string, unknown>;
};

export type AppendMessageInput = {
  role: ConversationMessageRole;
  content: string;
  status: ConversationMessageStatus;
  usage?: ConversationUsage;
  model?: string;
  metadata?: Record<string, unknown>;
};

/** 兼容旧版 `{ messages }` 调用的消息形状 */
export type ChatInputMessage = {
  role: ConversationMessageRole;
  content: string;
};
