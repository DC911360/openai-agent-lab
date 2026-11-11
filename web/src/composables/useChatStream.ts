import { onMounted, onScopeDispose, ref } from "vue";
import {
  abortChat,
  deleteConversation as deleteConversationApi,
  getConversation,
  listConversations,
  renameConversation as renameConversationApi,
  sendChatStream,
} from "../api/chat";
import type {
  ChatMessage,
  ChatStreamEvent,
  ChatUsage,
  ContextStats,
  Conversation,
  ConversationSummary,
} from "../types/chat";

const STORAGE_KEY = "openai-agent-lab:conversationId";

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "你好，我是你的前端技术导师。想聊点什么？",
  status: "done",
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** 解析单个 SSE 事件帧（可能包含多行 data:） */
function parseSseEvent(raw: string): ChatStreamEvent | null {
  const payload = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(payload) as ChatStreamEvent;
  } catch {
    return null;
  }
}

function welcomeMessages(): ChatMessage[] {
  return [{ ...WELCOME_MESSAGE }];
}

function mapConversationMessages(conversation: Conversation): ChatMessage[] {
  if (conversation.messages.length === 0) {
    return welcomeMessages();
  }

  return conversation.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    usage: message.usage,
  }));
}

export function useChatStream() {
  const messages = ref<ChatMessage[]>(welcomeMessages());
  const isStreaming = ref(false);
  const error = ref<string | null>(null);
  const usage = ref<ChatUsage | null>(null);
  const lastContext = ref<ContextStats | null>(null);

  const conversationId = ref<string | null>(null);
  const conversationTitle = ref("新会话");
  const conversations = ref<ConversationSummary[]>([]);
  const isLoadingConversation = ref(false);
  const isLoadingList = ref(false);

  let controller: AbortController | null = null;
  let currentRequestId: string | null = null;

  function persistConversationId(id: string | null): void {
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function applyConversation(conversation: Conversation): void {
    conversationId.value = conversation.id;
    conversationTitle.value = conversation.title;
    messages.value = mapConversationMessages(conversation);
    lastContext.value = null;
    usage.value = null;
    error.value = null;
    persistConversationId(conversation.id);
  }

  async function refreshConversations(): Promise<void> {
    isLoadingList.value = true;

    try {
      const list = await listConversations(30);
      conversations.value = list;

      if (conversationId.value) {
        const current = list.find((item) => item.id === conversationId.value);
        if (current) {
          conversationTitle.value = current.title;
        }
      }
    } catch (caught) {
      // 列表失败不阻塞聊天，控制台保留原因
      console.warn("加载会话列表失败：", caught);
    } finally {
      isLoadingList.value = false;
    }
  }

  async function loadConversation(id: string): Promise<void> {
    isLoadingConversation.value = true;
    error.value = null;

    try {
      const conversation = await getConversation(id);
      applyConversation(conversation);
    } finally {
      isLoadingConversation.value = false;
    }
  }

  async function initialize(): Promise<void> {
    await refreshConversations();

    const savedId = localStorage.getItem(STORAGE_KEY);
    if (!savedId) {
      return;
    }

    try {
      await loadConversation(savedId);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);

      if (message.includes("会话不存在")) {
        // 服务端已经没有这个会话（重启或被删除），回到新会话
        persistConversationId(null);
        conversationId.value = null;
        conversationTitle.value = "新会话";
        messages.value = welcomeMessages();
      } else {
        // 网络/服务端暂时不可用时保留 ID，下次刷新还能恢复
        error.value = message;
      }

      console.warn("恢复会话失败：", caught);
    }
  }

  async function selectConversation(id: string): Promise<void> {
    if (isStreaming.value || id === conversationId.value) {
      return;
    }

    try {
      await loadConversation(id);
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  }

  function newConversation(): void {
    if (isStreaming.value) {
      return;
    }

    conversationId.value = null;
    conversationTitle.value = "新会话";
    messages.value = welcomeMessages();
    lastContext.value = null;
    usage.value = null;
    error.value = null;
    persistConversationId(null);
  }

  async function removeConversation(id: string): Promise<void> {
    if (isStreaming.value) {
      return;
    }

    try {
      await deleteConversationApi(id);

      if (conversationId.value === id) {
        newConversation();
      }

      await refreshConversations();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  }

  async function renameConversation(
    id: string,
    title: string,
  ): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed || isStreaming.value) {
      return;
    }

    try {
      const updated = await renameConversationApi(id, trimmed);
      if (conversationId.value === id) {
        conversationTitle.value = updated.title;
      }
      await refreshConversations();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  }

  async function consumeStream(
    response: Response,
    assistant: ChatMessage,
  ): Promise<void> {
    if (!response.body) {
      throw new Error("当前浏览器不支持流式响应");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let terminal = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");

          const event = parseSseEvent(rawEvent);
          if (!event) {
            continue;
          }

          if (event.type === "delta") {
            assistant.content += event.content;
          } else if (event.type === "done") {
            if (event.requestId) {
              assistant.requestId = event.requestId;
            }
            usage.value = event.usage ?? null;
            assistant.usage = event.usage;
            assistant.context = event.context;
            assistant.citations = event.citations;
            lastContext.value = event.context ?? null;

            if (event.conversationId) {
              conversationId.value = event.conversationId;
              persistConversationId(event.conversationId);
            }

            assistant.status = "done";
            terminal = true;
          } else if (event.type === "aborted") {
            assistant.status = "aborted";
            terminal = true;
          } else if (event.type === "error") {
            assistant.status = "error";
            terminal = true;
            throw new Error(event.message);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!terminal) {
      throw new Error("连接意外结束，请重试");
    }
  }

  async function send(content: string): Promise<void> {
    const text = content.trim();
    if (!text || isStreaming.value) {
      return;
    }

    error.value = null;
    usage.value = null;
    lastContext.value = null;
    isStreaming.value = true;

    messages.value.push({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    });

    messages.value.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      status: "streaming",
    });

    // 必须拿到数组里的响应式代理，直接改原始对象不会触发视图更新
    const assistant = messages.value[messages.value.length - 1]!;

    const requestId = crypto.randomUUID();
    const activeController = new AbortController();
    currentRequestId = requestId;
    controller = activeController;
    assistant.requestId = requestId;

    try {
      const response = await sendChatStream(
        {
          conversationId: conversationId.value ?? undefined,
          message: text,
        },
        requestId,
        activeController.signal,
      );

      // 新会话由服务端自动创建；先从头里拿到 ID，后续轮次才能复用
      const headerConversationId =
        response.headers.get("X-Conversation-Id");
      if (headerConversationId) {
        conversationId.value = headerConversationId;
        persistConversationId(headerConversationId);
      }

      // 服务端会把请求头里的 X-Request-Id 回写，作为轨迹查询的唯一标记
      const headerRequestId = response.headers.get("X-Request-Id");
      if (headerRequestId) {
        assistant.requestId = headerRequestId;
      }

      await consumeStream(response, assistant);
    } catch (caught) {
      if (isAbortError(caught) || activeController.signal.aborted) {
        assistant.status = "aborted";
      } else {
        assistant.status = "error";
        error.value = caught instanceof Error ? caught.message : String(caught);
      }
    } finally {
      if (assistant.status === "streaming") {
        if (assistant.content) {
          assistant.status = "done";
        } else {
          assistant.status = "error";
          error.value ??= "生成失败，请稍后重试";
        }
      }

      isStreaming.value = false;
      currentRequestId = null;
      controller = null;

      // 首轮结束后服务端会生成标题，刷新列表同时同步标题
      if (conversationId.value) {
        void refreshConversations();
      }
    }
  }

  async function stop(): Promise<void> {
    const requestId = currentRequestId;
    if (!isStreaming.value || !requestId) {
      return;
    }

    try {
      const aborted = await abortChat(requestId);
      if (!aborted) {
        // 请求已结束或中断接口失败时，回退为直接断开连接
        controller?.abort();
      }
    } catch {
      controller?.abort();
    }
  }

  onMounted(() => {
    void initialize();
  });

  onScopeDispose(() => {
    controller?.abort();
  });

  return {
    messages,
    isStreaming,
    error,
    usage,
    lastContext,
    conversationId,
    conversationTitle,
    conversations,
    isLoadingConversation,
    isLoadingList,
    send,
    stop,
    newConversation,
    selectConversation,
    removeConversation,
    renameConversation,
    refreshConversations,
  };
}
