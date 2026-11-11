import { Router } from "express";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
} from "../conversation/conversation.service.js";
import {
  conversationIdSchema,
  createConversationSchema,
  listConversationsQuerySchema,
  updateConversationSchema,
} from "./conversation.schema.js";
import { setJsonLogResponse } from "./logger.js";
import { sendValidationError } from "./validation.js";

export const conversationsRouter = Router();

conversationsRouter.post("/", async (req, res) => {
  const parsed = createConversationSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    sendValidationError(res, parsed.error.issues);
    return;
  }

  const conversation = await createConversation(parsed.data);
  const payload = { conversation };
  setJsonLogResponse(res, payload);
  res.status(201).json(payload);
});

conversationsRouter.get("/", async (req, res) => {
  const parsed = listConversationsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    sendValidationError(res, parsed.error.issues);
    return;
  }

  const conversations = await listConversations(parsed.data);
  const payload = { count: conversations.length, conversations };
  setJsonLogResponse(res, payload);
  res.json(payload);
});

conversationsRouter.get("/:id", async (req, res) => {
  const parsed = conversationIdSchema.safeParse(req.params.id);

  if (!parsed.success) {
    sendValidationError(res, parsed.error.issues);
    return;
  }

  const conversation = await getConversation(parsed.data);
  const payload = { conversation };
  setJsonLogResponse(res, payload);
  res.json(payload);
});

conversationsRouter.patch("/:id", async (req, res) => {
  const id = conversationIdSchema.safeParse(req.params.id);
  const body = updateConversationSchema.safeParse(req.body);

  if (!id.success) {
    sendValidationError(res, id.error.issues);
    return;
  }
  if (!body.success) {
    sendValidationError(res, body.error.issues);
    return;
  }

  const conversation = await renameConversation(id.data, body.data.title);
  const payload = { conversation };
  setJsonLogResponse(res, payload);
  res.json(payload);
});

conversationsRouter.delete("/:id", async (req, res) => {
  const parsed = conversationIdSchema.safeParse(req.params.id);

  if (!parsed.success) {
    sendValidationError(res, parsed.error.issues);
    return;
  }

  await deleteConversation(parsed.data);
  const payload = { ok: true, id: parsed.data };
  setJsonLogResponse(res, payload);
  res.json(payload);
});
