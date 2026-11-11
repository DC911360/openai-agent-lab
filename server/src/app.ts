import cors from "cors";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { chatRouter } from "./api/chat.js";
import { conversationsRouter } from "./api/conversations.js";
import { healthRouter } from "./api/health.js";
import { logsRouter } from "./api/logs.js";
import { requestLogger } from "./api/request-logger.js";
import { env } from "./config/env.js";
import { AppError } from "./lib/errors.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by"); 

  const corsOrigin =
    env.corsOrigin === "*"
      ? true
      : env.corsOrigin.split(",").map((origin) => origin.trim());

  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger);

  app.use("/api/health", healthRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/logs", logsRouter);

  const notFoundHandler: RequestHandler = (_req, res) => {
    res.status(404).json({ error: "Not Found" });
  };
  app.use(notFoundHandler);

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "请求体不是合法的 JSON" });
      return;
    }

    if (error instanceof AppError) {
      res.status(error.status).json({ error: error.message });
      return;
    }

    const status = (error as { status?: number }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      res.status(status).json({ error: "请求体解析失败" });
      return;
    }

    console.error("未处理的服务器错误：", error);
    res.status(500).json({ error: "服务器内部错误" });
  };
  app.use(errorHandler);

  return app;
}
