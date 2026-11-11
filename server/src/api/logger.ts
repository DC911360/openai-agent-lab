import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type { RequestLog } from "./log.types.js";

const MAX_PREVIEW_LENGTH = 2000;

export function preview(text: string): string {
  if (text.length <= MAX_PREVIEW_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_PREVIEW_LENGTH)}…（已截断，共 ${text.length} 字符）`;
}

export function getLogEntry(res: Response): RequestLog | undefined {
  return res.locals.logEntry as RequestLog | undefined;
}

export function getRequestId(res: Response): string {
  return typeof res.locals.requestId === "string" && res.locals.requestId
    ? res.locals.requestId
    : randomUUID();
}

/** 把 JSON 响应写入日志条目；调用方负责决定记录哪些字段。 */
export function setJsonLogResponse(
  res: Response,
  payload: unknown,
): void {
  const logEntry = getLogEntry(res);
  if (logEntry) {
    logEntry.response = { mode: "json", content: JSON.stringify(payload) };
  }
}
