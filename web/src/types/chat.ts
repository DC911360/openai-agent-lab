export type ChatRole = "user" | "assistant";

export type ChatMessageStatus = "streaming" | "done" | "aborted" | "error";

export type ChatUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

/** 服务端本次请求的上下文统计 */
export type ContextStats = {
  strategy: "full" | "window" | "summary-window";
  budgetTokens: number;
  estimatedTokens: number;
  systemTokens: number;
  summaryTokens: number;
  memoryTokens: number;
  knowledgeTokens: number;
  historyTokens: number;
  currentTokens: number;

  includedMessages: number;
  droppedMessages: number;
  filteredMessages: number;

  summaryUsed: boolean;
  memoryUsed: number;
  knowledgeUsed: number;
  truncated: boolean;
};

/** 知识库引用来源 */
export type Citation = {
  index: number;
  id: string;
  source: string;
  title?: string;
  snippet: string;
  score?: number;
};

/** 前端页面使用的消息结构（带本地 id、展示状态与服务端统计） */
export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  status?: ChatMessageStatus;
  usage?: ChatUsage;
  context?: ContextStats;
  citations?: Citation[];
  /** 本次请求的唯一标记，用于查询服务端 Agent 轨迹 */
  requestId?: string;
};

/** 服务端 user → agent → model 轨迹事件 */
export type ChatTraceEvent = {
  at: string;
  type: string;
  traceId: string;
  round?: number;
  message?: string;
  content?: string;
  name?: string;
  toolCallId?: string;
  arguments?: string;
  request?: {
    model?: string;
    messages?: unknown[];
    tools?: unknown[];
  };
  usage?: ChatUsage;
  /** model_response 聚合的原始 chunk 列表 */
  chunks?: unknown[];
  toolCalls?: Array<{
    id?: string;
    type?: string;
    function: { name: string; arguments?: string };
  }>;
  [key: string]: unknown;
};

export type ChatTrace = {
  requestId: string;
  count: number;
  events: ChatTraceEvent[];
};

/** 发送给后端的请求：session 模式只传当前消息 */
export type ChatRequest = {
  conversationId?: string;
  message: string;
  stream?: boolean;
};

/** 服务端会话消息 */
export type ConversationMessage = {
  id: string;
  role: ChatRole;
  content: string;
  status: Exclude<ChatMessageStatus, "streaming">;
  createdAt: string;
  usage?: ChatUsage;
  model?: string;
};

/** 服务端会话详情 */
export type Conversation = {
  id: string;
  userId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  summaryUpdatedAt?: string;
  messages: ConversationMessage[];
};

/** 会话列表项 */
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
    role: ChatRole;
    content: string;
    createdAt: string;
  };
};

/** 与后端 SSE 事件协议保持一致 */
export type ChatStreamEvent =
  | { type: "delta"; content: string }
  | {
      type: "done";
      requestId?: string;
      usage?: ChatUsage;
      conversationId?: string;
      context?: ContextStats;
      citations?: Citation[];
    }
  | { type: "aborted"; message?: string }
  | { type: "error"; message: string };
