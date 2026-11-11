import type { LlmUsage } from "../ai/ai.types.js";
import type { ContextCitation, ContextStats } from "../context/context.types.js";

export type LogState = "pending" | "completed" | "closed";

export type ChatLogDetail = {
  mode: "session" | "stateless";
  conversationId?: string;
  stream: boolean;
  /** session 模式记录当前消息；stateless 模式记录整个 messages 数组 */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  context?: ContextStats;
};

export type ResponseLogDetail = {
  mode: "json" | "stream";
  content: string;
  finishReason?: string | null;
  chunkCount?: number;
  usage?: LlmUsage;
  context?: ContextStats;
  citations?: ContextCitation[];
};

export type RequestLog = {
  id: string;
  requestId: string;
  timestamp: string;
  method: string;
  path: string;
  status: number | null;
  durationMs: number | null;
  state: LogState;
  requestBody?: unknown;
  chat?: ChatLogDetail;
  response?: ResponseLogDetail;
  aborted?: { reason: string };
  error?: string;
};
