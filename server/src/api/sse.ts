import type { Response } from "express";
import type { LlmUsage } from "../ai/ai.types.js";
import type { ContextCitation, ContextStats } from "../context/context.types.js";

/** 对外 SSE 事件协议。 */
export type SseEvent =
  | { type: "delta"; content: string }
  | {
      type: "done";
      requestId?: string;
      usage?: LlmUsage;
      conversationId?: string;
      context?: ContextStats;
      citations?: ContextCitation[];
    }
  | { type: "aborted"; message?: string }
  | { type: "error"; message: string };

export function initSse(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

export function sendSse(res: Response, event: SseEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
