import { z } from "zod";

export const chatInputMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z
    .string()
    .trim()
    .min(1, "消息内容不能为空")
    .max(8000, "单条消息不能超过 8000 个字符"),
});

/**
 * 两种调用模式：
 * - session：`{ conversationId?, message }`，由服务端维护历史；
 * - stateless：`{ messages }`，兼容旧前端，服务端不写会话。
 */
export const chatRequestSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(64).optional(),
    message: z
      .string()
      .trim()
      .min(1, "消息内容不能为空")
      .max(8000, "单条消息不能超过 8000 个字符")
      .optional(),
    messages: z
      .array(chatInputMessageSchema)
      .min(1, "至少需要一条消息")
      .max(20, "最多支持 20 条消息")
      .optional(),
    stream: z.boolean().optional().default(true),
    userId: z.string().trim().min(1).max(64).optional(),
  })
  .superRefine((value, ctx) => {
    const hasMessage = typeof value.message === "string";
    const hasMessages = Array.isArray(value.messages);

    if (hasMessage === hasMessages) {
      ctx.addIssue({
        code: "custom",
        message: "message 与 messages 必须且只能提供一个",
        path: ["message"],
      });
      return;
    }

    if (value.conversationId && !hasMessage) {
      ctx.addIssue({
        code: "custom",
        message: "conversationId 只能与 message 一起使用",
        path: ["conversationId"],
      });
    }

    if (hasMessages && value.messages?.at(-1)?.role !== "user") {
      ctx.addIssue({
        code: "custom",
        message: "messages 的最后一条必须是 user 消息",
        path: ["messages"],
      });
    }
  });

export const abortChatRequestSchema = z.object({
  requestId: z
    .string()
    .trim()
    .min(1, "requestId 不能为空")
    .max(64, "requestId 不能超过 64 个字符"),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatInputMessage = z.infer<typeof chatInputMessageSchema>;
