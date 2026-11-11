import { Router } from "express";
import { conversationCount } from "../conversation/conversation.service.js";
import { knowledgeChunkCount } from "../knowledge/knowledge.service.js";
import { activeRequestCount } from "./active-requests.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  res.json({
    status: "ok",
    activeRequests: activeRequestCount(),
    conversations: await conversationCount(),
    knowledgeChunks: knowledgeChunkCount(),
  });
});
