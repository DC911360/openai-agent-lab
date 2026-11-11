/** 模型调用的统一契约：上下文层、会话层、记忆层都只依赖这些类型。 */

export type LlmRole = "system" | "user" | "assistant" | "tool";

/** assistant 消息中模型请求调用的工具 */
export type LlmToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type LlmMessage = {
  role: LlmRole;
  content: string;
  /** role 为 assistant 时，模型请求调用的工具 */
  tool_calls?: LlmToolCall[];
  /** role 为 tool 时，对应 assistant.tool_calls[].id */
  tool_call_id?: string;
};

export type LlmUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type LlmStreamEvent =
  | { type: "delta"; content: string }
  | { type: "usage"; usage: LlmUsage };

export type LlmCompletionResult = {
  content: string;
  finishReason: string | null;
  usage?: LlmUsage;
};

/** 调试用：把一次请求串联成 user → agent → model 的轨迹。 */
export type LlmTraceContext = {
  requestId?: string;
  conversationId?: string;
  userId?: string;
  userMessage?: string;
};

export type LlmRequestOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  trace?: LlmTraceContext;
};
