import type {
  ChatRequest,
  Conversation,
  ConversationSummary,
} from "../types/chat";

const CHAT_ENDPOINT = "/api/chat";
const ABORT_ENDPOINT = "/api/chat/abort";
const CONVERSATIONS_ENDPOINT = "/api/conversations";

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as {
      error?: string;
      details?: Array<{ path: string; message: string }>;
    };

    if (data.error && data.details?.length) {
      return `${data.error}：${data.details.map((item) => item.message).join("；")}`;
    }

    if (data.error) {
      return data.error;
    }
  } catch {
    // 非 JSON 响应，回退到状态码
  }

  return `请求失败（HTTP ${response.status}）`;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as T;
}

/** 发起 session 模式流式聊天请求，返回原始 Response，由调用方解析 SSE */
export async function sendChatStream(
  input: { conversationId?: string; message: string },
  requestId: string,
  signal: AbortSignal,
): Promise<Response> {
  const body: ChatRequest = {
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    message: input.message,
    stream: true,
  };

  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response;
}

/** 调用服务端中断接口；返回 false 表示请求已结束或不存在 */
export async function abortChat(requestId: string): Promise<boolean> {
  const response = await fetch(ABORT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId }),
  });

  return response.ok;
}

export async function listConversations(
  limit = 30,
): Promise<ConversationSummary[]> {
  const data = await requestJson<{
    count: number;
    conversations: ConversationSummary[];
  }>(`${CONVERSATIONS_ENDPOINT}?limit=${limit}`);

  return data.conversations;
}

export async function getConversation(id: string): Promise<Conversation> {
  const data = await requestJson<{ conversation: Conversation }>(
    `${CONVERSATIONS_ENDPOINT}/${encodeURIComponent(id)}`,
  );

  return data.conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  await requestJson<{ ok: boolean }>(
    `${CONVERSATIONS_ENDPOINT}/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export async function renameConversation(
  id: string,
  title: string,
): Promise<Conversation> {
  const data = await requestJson<{ conversation: Conversation }>(
    `${CONVERSATIONS_ENDPOINT}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
  );

  return data.conversation;
}
