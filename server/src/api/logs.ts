import { readFile } from "node:fs/promises";
import { Router } from "express";
import { z } from "zod";
import { getStreamLogFile } from "../ai/stream-chunk-log.js";
import { getLogs } from "./log-store.js";
import { sendValidationError } from "./validation.js";

export const logsRouter = Router();

const logsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  requestId: z.string().trim().min(1).max(64).optional(),
});

logsRouter.get("/", (req, res) => {
  const parsed = logsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    sendValidationError(res, parsed.error.issues);
    return;
  }

  const logs = getLogs(parsed.data);
  res.json({ count: logs.length, logs });
});

const traceParamsSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
});

type TraceEvent = { traceId?: string } & Record<string, unknown>;

/** 按 requestId 读取 user → agent → model 轨迹（来自 STREAM_CHUNK_LOG 落盘文件）。 */
logsRouter.get("/traces/:requestId", async (req, res) => {
  const parsed = traceParamsSchema.safeParse(req.params);

  if (!parsed.success) {
    sendValidationError(res, parsed.error.issues);
    return;
  }

  const { requestId } = parsed.data;
  const logFile = getStreamLogFile();

  if (!logFile) {
    res.status(404).json({
      error: "轨迹落盘未开启，请设置 STREAM_CHUNK_LOG=1 后重启服务",
      requestId,
    });
    return;
  }

  let raw: string;

  try {
    raw = await readFile(logFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ error: "暂无轨迹日志", requestId });
      return;
    }
    throw error;
  }

  const events: TraceEvent[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed) as TraceEvent;
      if (event.traceId === requestId) {
        events.push(event);
      }
    } catch {
      // 跳过损坏的行，不影响其他轨迹
    }
  }

  if (events.length === 0) {
    res.status(404).json({ error: "未找到该请求的轨迹", requestId });
    return;
  }

  res.json({ requestId, count: events.length, events });
});
