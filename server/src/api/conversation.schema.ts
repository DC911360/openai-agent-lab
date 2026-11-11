import { z } from "zod";

export const conversationIdSchema = z
  .string()
  .trim()
  .min(1, "conversationId 不能为空")
  .max(64, "conversationId 不能超过 64 个字符");

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  userId: z.string().trim().min(1).max(64).optional(),
});

export const listConversationsQuerySchema = z.object({
  userId: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const updateConversationSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "标题不能为空")
    .max(80, "标题不能超过 80 个字符"),
});
