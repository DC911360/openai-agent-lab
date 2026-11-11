<script setup lang="ts">
import MarkdownContent from "./MarkdownContent.vue";
import type { ChatMessage } from "../types/chat";

defineProps<{
  message: ChatMessage;
}>();

const emit = defineEmits<{
  (event: "show-trace", requestId: string): void;
}>();
</script>

<template>
  <article class="message" :class="`message--${message.role}`">
    <span class="message__avatar">{{ message.role === "user" ? "你" : "AI" }}</span>

    <div class="message__body">
      <div
        class="message__bubble"
        :class="{ 'message__bubble--markdown': message.role === 'assistant' }"
      >
        <template v-if="message.content">
          <MarkdownContent
            v-if="message.role === 'assistant'"
            :content="message.content"
          />
          <template v-else>{{ message.content }}</template>
          <span
            v-if="message.status === 'streaming'"
            class="message__cursor"
            aria-hidden="true"
          >▍</span>
        </template>
        <span
          v-else-if="message.status === 'streaming'"
          class="message__thinking"
        >正在思考…</span>
        <span
          v-else-if="message.status === 'error'"
          class="message__thinking"
        >生成失败</span>
      </div>

      <p
        v-if="message.role === 'assistant' && message.context"
        class="message__context"
      >
        上下文 {{ message.context.includedMessages }} 条 · 估算
        {{ message.context.estimatedTokens }} tokens
        <span v-if="message.context.droppedMessages">
          · 丢弃 {{ message.context.droppedMessages }}
        </span>
        <span v-if="message.context.summaryUsed"> · 摘要</span>
        <span v-if="message.context.memoryUsed">
          · 记忆 {{ message.context.memoryUsed }}
        </span>
        <span v-if="message.context.knowledgeUsed">
          · 知识 {{ message.context.knowledgeUsed }}
        </span>
      </p>

      <details
        v-if="message.role === 'assistant' && message.citations?.length"
        class="message__citations"
      >
        <summary>参考资料 · {{ message.citations.length }}</summary>
        <ol>
          <li v-for="citation in message.citations" :key="citation.id">
            <span class="message__citation-title">
              [{{ citation.index }}]
              {{ citation.title || citation.source }}
            </span>
            <span class="message__citation-source">
              {{ citation.source }}
            </span>
            <p>{{ citation.snippet }}</p>
          </li>
        </ol>
      </details>

      <button
        v-if="
          message.role === 'assistant' &&
          message.requestId &&
          message.status !== 'streaming'
        "
        type="button"
        class="message__trace-button"
        @click="emit('show-trace', message.requestId)"
      >
        <span class="message__trace-icon" aria-hidden="true">◉</span>
        Agent 轨迹
      </button>

      <p v-if="message.status === 'aborted'" class="message__status">
        已停止生成
      </p>
      <p
        v-else-if="message.status === 'error' && message.content"
        class="message__status message__status--error"
      >
        生成中断，请重试
      </p>
    </div>
  </article>
</template>

<style scoped>
.message {
  display: flex;
  gap: 10px;
  max-width: 82%;
  align-items: flex-start;
}

.message--user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.message__avatar {
  display: grid;
  place-items: center;
  flex: 0 0 34px;
  height: 34px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  background: #eef2f7;
  border: 1px solid #dbe3ee;
}

.message--assistant .message__avatar {
  color: #ffffff;
  background: linear-gradient(135deg, #4f7cff, #7b5cff);
  border-color: transparent;
}

.message__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  min-width: 0;
}

.message--user .message__body {
  align-items: flex-end;
}

.message__bubble {
  margin: 0;
  padding: 10px 14px;
  border-radius: 14px;
  border-top-left-radius: 4px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.message--user .message__bubble {
  border-top-left-radius: 14px;
  border-top-right-radius: 4px;
  color: #ffffff;
  background: linear-gradient(135deg, #4f7cff, #6d5cff);
  border-color: transparent;
}

.message__bubble--markdown {
  white-space: normal;
}

.message__thinking {
  color: var(--muted);
}

.message__cursor {
  display: inline-block;
  margin-left: 2px;
  color: var(--accent);
  animation: blink 1s step-end infinite;
}

.message__context {
  margin: 0;
  font-size: 10px;
  color: var(--muted);
}

.message__citations {
  width: 100%;
  padding: 8px 10px;
  font-size: 12px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.message__citations summary {
  color: var(--muted);
  cursor: pointer;
}

.message__citations ol {
  margin: 8px 0 0;
  padding-left: 18px;
}

.message__citations li {
  margin: 6px 0;
}

.message__citation-title {
  color: var(--text);
}

.message__citation-source {
  margin-left: 6px;
  font-size: 10px;
  color: var(--muted);
}

.message__citations p {
  margin: 3px 0 0;
  line-height: 1.5;
  color: var(--muted);
}

.message__trace-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  font-size: 11px;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid #d6e2ff;
  border-radius: 999px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.message__trace-button:hover {
  background: #e3edff;
  border-color: var(--accent);
}

.message__trace-icon {
  font-size: 9px;
}

.message__status {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}

.message__status--error {
  color: var(--danger);
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}
</style>
