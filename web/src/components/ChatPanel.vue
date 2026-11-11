<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import MessageItem from "./MessageItem.vue";
import TracePanel from "./TracePanel.vue";
import { useChatStream } from "../composables/useChatStream";
import type { ConversationSummary } from "../types/chat";

const {
  messages,
  isStreaming,
  error,
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
} = useChatStream();

const input = ref("");
const messageList = ref<HTMLElement | null>(null);
const inputElement = ref<HTMLTextAreaElement | null>(null);
const traceRequestId = ref<string | null>(null);

const canSend = computed(() => input.value.trim().length > 0);

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resizeInput(): void {
  const element = inputElement.value;
  if (!element) {
    return;
  }
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
}

function scrollToBottom(force = false): void {
  void nextTick(() => {
    const list = messageList.value;
    if (!list) {
      return;
    }

    const distanceToBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight;

    // 用户主动上滚时暂停跟随，除非是刚发送消息或切换会话
    if (!force && distanceToBottom > 120) {
      return;
    }

    list.scrollTo({
      top: list.scrollHeight,
      behavior: force ? "smooth" : "auto",
    });
  });
}

async function handleSend(): Promise<void> {
  const content = input.value.trim();
  if (!content || isStreaming.value) {
    return;
  }

  input.value = "";
  void nextTick(resizeInput);
  const pending = send(content);
  scrollToBottom(true);
  await pending;
}

function handleEnter(event: KeyboardEvent): void {
  if (event.isComposing) {
    return;
  }
  event.preventDefault();
  void handleSend();
}

async function handleNewConversation(): Promise<void> {
  newConversation();
  input.value = "";
  await nextTick();
  resizeInput();
  inputElement.value?.focus();
}

async function handleSelectConversation(id: string): Promise<void> {
  await selectConversation(id);
  scrollToBottom(true);
}

async function handleRenameConversation(
  conversation: ConversationSummary,
): Promise<void> {
  if (isStreaming.value) {
    return;
  }

  const title = window.prompt("重命名会话", conversation.title);
  if (title) {
    await renameConversation(conversation.id, title);
  }
}

async function handleDeleteConversation(
  conversation: ConversationSummary,
): Promise<void> {
  if (isStreaming.value) {
    return;
  }

  const confirmed = window.confirm(
    `删除会话「${conversation.title}」？此操作不可恢复。`,
  );
  if (!confirmed) {
    return;
  }

  await removeConversation(conversation.id);
}

watch(messages, () => scrollToBottom(), { deep: true });
watch(conversationId, () => scrollToBottom(true));

onMounted(() => scrollToBottom(true));
</script>

<template>
  <main class="shell">
    <aside class="sidebar">
      <div class="sidebar__header">
        <div>
          <h1>会话</h1>
          <p>{{ conversations.length }} 个已保存会话</p>
        </div>
        <button
          type="button"
          class="sidebar__new"
          :disabled="isStreaming"
          @click="handleNewConversation"
        >
          + 新会话
        </button>
      </div>

      <ul class="sidebar__list">
        <li
          v-for="conversation in conversations"
          :key="conversation.id"
          class="conversation"
          :class="{
            'conversation--active': conversation.id === conversationId,
          }"
        >
          <button
            type="button"
            class="conversation__select"
            :disabled="isStreaming"
            @click="handleSelectConversation(conversation.id)"
          >
            <span class="conversation__title">{{ conversation.title }}</span>
            <span class="conversation__meta">
              {{ formatTime(conversation.updatedAt) }} ·
              {{ conversation.messageCount }} 条
            </span>
          </button>

          <span class="conversation__actions">
            <button
              type="button"
              class="conversation__action"
              title="重命名"
              :disabled="isStreaming"
              @click="handleRenameConversation(conversation)"
            >
              ✎
            </button>
            <button
              type="button"
              class="conversation__action conversation__action--danger"
              title="删除"
              :disabled="isStreaming"
              @click="handleDeleteConversation(conversation)"
            >
              ×
            </button>
          </span>
        </li>

        <li
          v-if="!isLoadingList && conversations.length === 0"
          class="sidebar__empty"
        >
          还没有会话。发送第一条消息后，服务端会自动创建并同步到列表。
        </li>
      </ul>

      <button
        type="button"
        class="sidebar__refresh"
        :disabled="isLoadingList || isStreaming"
        @click="refreshConversations"
      >
        {{ isLoadingList ? "刷新中…" : "刷新列表" }}
      </button>
    </aside>

    <section class="chat">
      <header class="chat__header">
        <div class="chat__heading">
          <h1>{{ conversationId ? conversationTitle : "新会话" }}</h1>
          <p>Vue 3 + TypeScript · DeepSeek 流式对话</p>
        </div>

        <div class="chat__status">
          <div
            v-if="lastContext"
            class="chat__context"
            title="服务端本次实际发送给模型的上下文"
          >
            <span>历史 {{ lastContext.includedMessages }}</span>
            <span v-if="lastContext.droppedMessages">
              丢弃 {{ lastContext.droppedMessages }}
            </span>
            <span>≈{{ lastContext.estimatedTokens }} tokens</span>
            <span v-if="lastContext.summaryUsed">摘要</span>
            <span v-if="lastContext.memoryUsed">
              记忆 {{ lastContext.memoryUsed }}
            </span>
            <span v-if="lastContext.knowledgeUsed">
              知识 {{ lastContext.knowledgeUsed }}
            </span>
          </div>

          <span
            class="chat__badge"
            :class="{ 'chat__badge--active': isStreaming }"
          >
            {{ isStreaming ? "生成中" : conversationId ? "已同步" : "新会话" }}
          </span>
        </div>
      </header>

      <section ref="messageList" class="chat__messages" aria-live="polite">
        <p v-if="isLoadingConversation" class="chat__loading">
          正在加载会话…
        </p>

        <MessageItem
          v-for="message in messages"
          :key="message.id"
          :message="message"
          @show-trace="traceRequestId = $event"
        />
      </section>

      <p v-if="error" class="chat__error">{{ error }}</p>

      <form class="chat__composer" @submit.prevent="handleSend">
        <textarea
          ref="inputElement"
          v-model="input"
          rows="1"
          maxlength="8000"
          placeholder="输入问题，Enter 发送"
          :disabled="isStreaming"
          @input="resizeInput"
          @keydown.enter.exact="handleEnter"
        ></textarea>

        <button
          v-if="isStreaming"
          type="button"
          class="chat__stop"
          @click="stop"
        >
          停止生成
        </button>
        <button v-else type="submit" :disabled="!canSend">
          发送
        </button>
      </form>
    </section>

    <TracePanel
      v-if="traceRequestId"
      :request-id="traceRequestId"
      @close="traceRequestId = null"
    />
  </main>
</template>

<style scoped>
.shell {
  width: min(1120px, calc(100% - 48px));
  height: calc(100vh - 48px);
  height: calc(100dvh - 48px);
  margin: 24px auto;
  display: flex;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: var(--shadow);
  backdrop-filter: blur(16px);
}

.sidebar {
  flex: 0 0 250px;
  width: 250px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: var(--surface-soft);
}

.sidebar__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 18px 16px 12px;
}

.sidebar__header h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.sidebar__header p {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--muted);
}

.sidebar__new {
  flex: 0 0 auto;
  padding: 6px 10px;
  color: var(--accent);
  font-size: 12px;
  background: var(--accent-soft);
  border: 1px solid #c9d8ff;
  border-radius: 8px;
  cursor: pointer;
}

.sidebar__new:disabled,
.sidebar__refresh:disabled,
.conversation__select:disabled,
.conversation__action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.sidebar__list {
  flex: 1;
  margin: 0;
  padding: 0 10px;
  overflow-y: auto;
  list-style: none;
}

.conversation {
  display: flex;
  align-items: stretch;
  gap: 2px;
  margin-bottom: 4px;
  border: 1px solid transparent;
  border-radius: 10px;
}

.conversation--active {
  background: var(--accent-soft);
  border-color: #c7d8ff;
}

.conversation__select {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 9px 10px;
  color: var(--text);
  text-align: left;
  background: transparent;
  border: none;
  cursor: pointer;
}

.conversation__title {
  max-width: 100%;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation__meta {
  font-size: 10px;
  color: var(--muted);
}

.conversation__actions {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding-right: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.conversation:hover .conversation__actions,
.conversation:focus-within .conversation__actions,
.conversation--active .conversation__actions {
  opacity: 1;
}

.conversation__action {
  width: 22px;
  height: 20px;
  padding: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.conversation__action:hover {
  color: var(--text);
  background: rgba(15, 23, 42, 0.06);
}

.conversation__action--danger:hover {
  color: var(--danger);
}

.sidebar__empty {
  margin: 12px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
}

.sidebar__refresh {
  margin: 10px 16px 16px;
  padding: 7px 10px;
  color: var(--muted);
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}

.chat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border);
}

.chat__heading {
  min-width: 0;
}

.chat__heading h1 {
  max-width: 100%;
  margin: 0;
  overflow: hidden;
  font-size: 16px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat__heading p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--muted);
}

.chat__status {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.chat__context {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  max-width: 380px;
  font-size: 10px;
  color: var(--muted);
}

.chat__context span {
  padding: 2px 6px;
  white-space: nowrap;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.chat__badge {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--accent);
  border: 1px solid #c9d8ff;
  border-radius: 999px;
  background: var(--accent-soft);
}

.chat__badge--active {
  color: var(--success);
  border-color: #bbf7d0;
  background: var(--success-soft);
}

.chat__messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px;
  overflow-y: auto;
}

.chat__loading {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.chat__error {
  margin: 0;
  padding: 10px 16px;
  font-size: 13px;
  color: var(--danger);
  background: var(--danger-soft);
  border-top: 1px solid #fecaca;
}

.chat__composer {
  display: flex;
  gap: 10px;
  padding: 16px;
  border-top: 1px solid var(--border);
  background: var(--surface-soft);
}

.chat__composer textarea {
  flex: 1;
  min-width: 0;
  height: 44px;
  max-height: 120px;
  padding: 12px 14px;
  color: var(--text);
  line-height: 1.4;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  outline: none;
  resize: none;
}

.chat__composer textarea:focus {
  border-color: var(--accent);
}

.chat__composer textarea:disabled {
  opacity: 0.6;
}

.chat__composer button {
  padding: 0 22px;
  color: #fff;
  font-weight: 600;
  background: var(--accent);
  border: none;
  border-radius: 10px;
  cursor: pointer;
}

.chat__composer button:disabled {
  cursor: not-allowed;
  background: #cbd5e1;
}

.chat__composer .chat__stop {
  background: var(--danger);
}

@media (max-width: 820px) {
  .shell {
    flex-direction: column;
    width: 100%;
    height: 100vh;
    height: 100dvh;
    margin: 0;
    border: none;
    border-radius: 0;
  }

  .sidebar {
    flex: 0 0 auto;
    width: 100%;
    max-height: 168px;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .sidebar__header {
    padding: 12px 14px 8px;
  }

  .sidebar__list {
    display: flex;
    gap: 6px;
    padding: 0 10px 8px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .conversation {
    flex: 0 0 auto;
    min-width: 190px;
    margin-bottom: 0;
  }

  .conversation__actions {
    flex-direction: row;
    align-items: center;
    padding-right: 6px;
    opacity: 1;
  }

  .sidebar__empty {
    margin: 8px 14px;
  }

  .sidebar__refresh {
    display: none;
  }

  .chat {
    flex: 1;
    min-height: 0;
  }

  .chat__header {
    padding: 12px 16px;
  }

  .chat__context {
    display: none;
  }

  .chat__messages {
    padding: 16px;
  }

  .chat__composer {
    padding: 12px;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }
}
</style>
