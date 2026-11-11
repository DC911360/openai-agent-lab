import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type OpenAI from "openai";
import { env } from "../config/env.js";
import type { LlmToolCall, LlmUsage } from "./ai.types.js";

const logFile = env.streamChunkLogFile ? resolve(env.streamChunkLogFile) : null;

let dirReady = false;
let disabled = false;

if (logFile) {
  console.log(`[stream] 轨迹日志落盘：${logFile}`);
}

/** 是否开启了流式轨迹落盘（STREAM_CHUNK_LOG）。 */
export function isStreamLogEnabled(): boolean {
  return logFile !== null && !disabled;
}

/** 轨迹日志文件绝对路径；未开启时为 null。 */
export function getStreamLogFile(): string | null {
  return logFile;
}

/**
 * 一次流式请求的完整轨迹事件：
 * user（用户输入）→ model_request（Agent 发给模型的上下文）
 * → model_response（模型返回：本轮全部 chunk 聚合 + 完整文本）
 * → tool_call / tool_result（Agent 执行工具）
 * → model_request（带着工具结果再次请求模型）→ …
 */
export type StreamLogEvent =
  | {
      type: "user";
      traceId: string;
      requestId?: string;
      conversationId?: string;
      userId?: string;
      message: string;
    }
  | {
      type: "model_request";
      traceId: string;
      round: number;
      /** 实际发给模型的完整请求体：system prompt、messages、tools、参数都在这里 */
      request: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
    }
  | {
      type: "model_response";
      traceId: string;
      round: number;
      model: string;
      finishReason: string | null;
      content: string;
      usage?: LlmUsage;
      /** 本轮收到的全部原始 chunk，聚合在一条日志里 */
      chunks: unknown[];
    }
  | {
      type: "tool_call";
      traceId: string;
      round: number;
      /** 模型请求调用的工具（已按 index 拼接完整） */
      toolCalls: LlmToolCall[];
    }
  | {
      type: "tool_execute";
      traceId: string;
      round: number;
      toolCallId: string;
      name: string;
      /** 模型给出的原始 JSON 参数串 */
      arguments: string;
    }
  | {
      type: "tool_result";
      traceId: string;
      round: number;
      toolCallId: string;
      name: string;
      content: string;
    };

/**
 * 调试用：每个轨迹事件写一行 JSON（JSONL），便于 grep / jq 还原整条链路。
 * STREAM_CHUNK_LOG 未开启时不做任何事；写入失败只会禁用落盘，不影响对话。
 */
export function writeStreamLog(event: StreamLogEvent): void {
  if (!isStreamLogEnabled() || !logFile) {
    return;
  }

  try {
    if (!dirReady) {
      mkdirSync(dirname(logFile), { recursive: true });
      dirReady = true;
    }

    appendFileSync(
      logFile,
      `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
      "utf8",
    );
  } catch (error) {
    disabled = true;
    console.error(
      `[stream] 轨迹落盘失败，后续不再尝试：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
