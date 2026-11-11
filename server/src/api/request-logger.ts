import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { preview } from "./logger.js";
import { addLog } from "./log-store.js";
import type { RequestLog } from "./log.types.js";

export const requestLogger: RequestHandler = (req, res, next) => {
  // 日志查询接口本身不记录，避免轮询把日志刷满
  if (req.originalUrl.startsWith("/api/logs")) {
    next();
    return;
  }

  const requestId = req.get("x-request-id")?.trim() || randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const startedAt = Date.now();
  const { method, originalUrl } = req;
  const body = req.body === undefined ? "" : preview(JSON.stringify(req.body));

  const entry: RequestLog = {
    id: randomUUID(),
    requestId,
    timestamp: new Date().toISOString(),
    method,
    path: originalUrl,
    status: null,
    durationMs: null,
    state: "pending",
    requestBody: req.body,
  };
  res.locals.logEntry = entry;
  addLog(entry);

  console.log(
    `[req] ${requestId} ${method} ${originalUrl}${body ? ` ${body}` : ""}`,
  );

  res.on("close", () => {
    const state = res.writableFinished ? "completed" : "closed";
    const duration = Date.now() - startedAt;

    entry.status = res.statusCode;
    entry.durationMs = duration;
    entry.state = state;

    console.log(
      `[res] ${requestId} ${method} ${originalUrl} ${res.statusCode} ${duration}ms ${state}`,
    );
  });

  next();
};
