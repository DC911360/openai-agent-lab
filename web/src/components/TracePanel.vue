<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getChatTrace } from "../api/trace";
import type { ChatTrace, ChatTraceEvent } from "../types/chat";

const props = defineProps<{
  requestId: string;
}>();

const emit = defineEmits<{
  (event: "close"): void;
}>();

const trace = ref<ChatTrace | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const items = computed(() => trace.value?.events ?? []);

type ChunkDelta = {
  role?: string;
  content?: string;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

type ChunkChoice = {
  index?: number;
  delta?: ChunkDelta;
  finish_reason?: string | null;
  logprobs?: unknown;
};

type ChunkLike = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  system_fingerprint?: string;
  choices?: ChunkChoice[];
  usage?: unknown;
};

type MergedToolCall = {
  index: number;
  id?: string;
  type?: string;
  name: string;
  arguments: string;
};

type MergedChoice = {
  index: number;
  role?: string;
  content: string;
  toolCalls: Map<number, MergedToolCall>;
  finishReason: string | null;
  logprobs?: unknown;
};

/** 把一轮模型返回的所有流式 chunk 合并成一条完整 chunk */
function mergeChunks(chunks: unknown[]): Record<string, unknown> {
  const first = (chunks[0] ?? {}) as ChunkLike;
  const merged: Record<string, unknown> = {};

  for (const key of [
    "id",
    "object",
    "created",
    "model",
    "system_fingerprint",
  ] as const) {
    if (first[key] !== undefined) {
      merged[key] = first[key];
    }
  }

  const choices = new Map<number, MergedChoice>();
  let usage: unknown;

  for (const raw of chunks) {
    const chunk = raw as ChunkLike;

    if (chunk.usage) {
      usage = chunk.usage;
    }

    for (const choice of chunk.choices ?? []) {
      const index = choice.index ?? 0;
      const current = choices.get(index) ?? {
        index,
        content: "",
        toolCalls: new Map<number, MergedToolCall>(),
        finishReason: null,
      };

      const delta = choice.delta;

      if (delta?.role) {
        current.role = delta.role;
      }
      if (delta?.content) {
        current.content += delta.content;
      }

      for (const toolCall of delta?.tool_calls ?? []) {
        const callIndex = toolCall.index ?? 0;
        const call = current.toolCalls.get(callIndex) ?? {
          index: callIndex,
          name: "",
          arguments: "",
        };

        if (toolCall.id) {
          call.id = toolCall.id;
        }
        if (toolCall.type) {
          call.type = toolCall.type;
        }
        if (toolCall.function?.name) {
          call.name += toolCall.function.name;
        }
        if (toolCall.function?.arguments) {
          call.arguments += toolCall.function.arguments;
        }

        current.toolCalls.set(callIndex, call);
      }

      if (choice.finish_reason) {
        current.finishReason = choice.finish_reason;
      }
      if (choice.logprobs !== undefined) {
        current.logprobs = choice.logprobs;
      }

      choices.set(index, current);
    }
  }

  merged.choices = [...choices.values()]
    .sort((a, b) => a.index - b.index)
    .map((choice) => ({
      index: choice.index,
      delta: {
        ...(choice.role ? { role: choice.role } : {}),
        ...(choice.content ? { content: choice.content } : {}),
        ...(choice.toolCalls.size > 0
          ? {
              tool_calls: [...choice.toolCalls.values()]
                .sort((a, b) => a.index - b.index)
                .map((call) => ({
                  index: call.index,
                  ...(call.id ? { id: call.id } : {}),
                  ...(call.type ? { type: call.type } : {}),
                  function: {
                    name: call.name,
                    arguments: call.arguments,
                  },
                })),
            }
          : {}),
      },
      ...(choice.logprobs !== undefined ? { logprobs: choice.logprobs } : {}),
      finish_reason: choice.finishReason,
    }));

  if (usage) {
    merged.usage = usage;
  }

  return merged;
}

/** 旧轨迹没有原始 chunks 时，用服务端聚合结果拼一条完整 chunk */
function fallbackChunk(event: ChatTraceEvent): Record<string, unknown> {
  return {
    ...(event.model ? { model: event.model } : {}),
    choices: [
      {
        index: 0,
        delta: {
          ...(event.content ? { content: event.content } : {}),
          ...(event.toolCalls?.length
            ? {
                tool_calls: event.toolCalls.map((call, index) => ({
                  index,
                  ...(call.id ? { id: call.id } : {}),
                  ...(call.type ? { type: call.type } : {}),
                  function: call.function,
                })),
              }
            : {}),
        },
        finish_reason: event.finishReason ?? null,
      },
    ],
    ...(event.usage ? { usage: event.usage } : {}),
  };
}

type DisplayToolCall = { name: string; arguments: string };

/** 从合并后的完整 chunk 里取出模型请求的工具调用 */
function responseToolCalls(
  chunk: Record<string, unknown> | null,
): DisplayToolCall[] {
  const choices = chunk?.choices as
    | Array<{
        delta?: {
          tool_calls?: Array<{
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>
    | undefined;

  const calls: DisplayToolCall[] = [];

  for (const choice of choices ?? []) {
    for (const toolCall of choice.delta?.tool_calls ?? []) {
      calls.push({
        name: toolCall.function?.name ?? "未知工具",
        arguments: toolCall.function?.arguments ?? "",
      });
    }
  }

  return calls;
}

function formatArguments(raw: string): string {
  if (!raw) {
    return "（无参数）";
  }

  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const preparedItems = computed(() => {
  const events = items.value;

  return events.map((event, index) => {
    const response =
      event.type === "model_response"
        ? event.chunks?.length
          ? mergeChunks(event.chunks)
          : fallbackChunk(event)
        : null;

    // 模型请求耗时 = 到下一条 model_response；工具耗时 = 到下一条 tool_result
    const nextAt = events[index + 1]?.at;
    const elapsedMs =
      nextAt && (event.type === "model_request" || event.type === "tool_execute")
        ? Date.parse(nextAt) - Date.parse(event.at)
        : Number.NaN;

    return {
      event,
      response,
      toolCalls: responseToolCalls(response),
      durationText: Number.isFinite(elapsedMs)
        ? `耗时 ${formatDuration(elapsedMs)}`
        : "",
    };
  });
});

const EVENT_LABELS: Record<string, string> = {
  user: "用户输入",
  model_request: "模型请求",
  model_response: "模型响应",
  tool_call: "模型请求工具",
  tool_execute: "Agent 执行工具",
  tool_result: "工具结果",
};

function eventTitle(event: ChatTraceEvent): string {
  return EVENT_LABELS[event.type] ?? event.type;
}

function eventSummary(event: ChatTraceEvent): string {
  switch (event.type) {
    case "user":
      return event.message ?? "";
    case "model_request": {
      const model = event.request?.model ?? "未知模型";
      const messages = event.request?.messages?.length ?? 0;
      return `${model} · ${messages} 条消息`;
    }
    case "model_response": {
      const text = event.content?.trim() || "（无文本）";
      const tokens = event.usage?.total_tokens;
      const tail = tokens ? ` · ${tokens} tokens` : "";
      return `${text}${tail}`;
    }
    case "tool_call": {
      const names = (event.toolCalls ?? [])
        .map((call) => call.function.name)
        .join("、");
      return names || "（无工具）";
    }
    case "tool_execute":
      return `${event.name ?? "工具"} · ${event.arguments || "（无参数）"}`;
    case "tool_result":
      return `${event.name ?? "工具"} · ${(event.content ?? "").length} 字符`;
    default:
      return "";
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  trace.value = null;

  try {
    trace.value = await getChatTrace(props.requestId);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    emit("close");
  }
}

watch(() => props.requestId, load, { immediate: true });

onMounted(() => {
  document.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div class="trace-overlay" @click.self="emit('close')">
      <aside
        class="trace-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Agent 轨迹"
      >
        <header class="trace-panel__header">
          <div class="trace-panel__heading">
            <h2>Agent 轨迹</h2>
            <p class="trace-panel__id" :title="requestId">
              {{ requestId }}
            </p>
          </div>

          <div class="trace-panel__actions">
            <span v-if="trace" class="trace-panel__count">
              {{ trace.count }} 条
            </span>
            <button
              type="button"
              class="trace-panel__close"
              aria-label="关闭"
              @click="emit('close')"
            >
              ×
            </button>
          </div>
        </header>

        <div class="trace-panel__body">
          <p v-if="loading" class="trace-panel__status">加载中…</p>
          <p
            v-else-if="error"
            class="trace-panel__status trace-panel__status--error"
          >
            {{ error }}
          </p>

          <ol v-else-if="preparedItems.length" class="trace-timeline">
            <li
              v-for="(item, index) in preparedItems"
              :key="`${item.event.type}-${index}`"
              class="trace-event"
              :class="`trace-event--${item.event.type}`"
            >
              <span class="trace-event__dot" aria-hidden="true"></span>

              <div class="trace-event__card">
                <div class="trace-event__head">
                  <span class="trace-event__title">
                    {{ eventTitle(item.event) }}
                    <span
                      v-if="item.event.round !== undefined"
                      class="trace-event__round"
                    >
                      第 {{ item.event.round + 1 }} 轮
                    </span>
                  </span>
                  <span class="trace-event__meta">
                    <span
                      v-if="item.durationText"
                      class="trace-event__duration"
                    >
                      {{ item.durationText }}
                    </span>
                    <span class="trace-event__time">
                      {{ formatTime(item.event.at) }}
                    </span>
                  </span>
                </div>

                <p v-if="!item.response" class="trace-event__summary">
                  {{ eventSummary(item.event) }}
                </p>

                <div v-else class="trace-final">
                  <template v-if="item.toolCalls.length">
                    <p class="trace-final__label">工具调用</p>
                    <div
                      v-for="(call, callIndex) in item.toolCalls"
                      :key="`${call.name}-${callIndex}`"
                      class="trace-final__tool"
                    >
                      <span class="trace-final__tool-name">{{ call.name }}</span>
                      <pre>{{ formatArguments(call.arguments) }}</pre>
                    </div>
                  </template>

                  <p v-if="item.event.usage" class="trace-final__usage">
                    <span class="trace-final__token trace-final__token--prompt">
                      prompt {{ item.event.usage.prompt_tokens }}
                    </span>
                    <span
                      class="trace-final__token trace-final__token--completion"
                    >
                      completion {{ item.event.usage.completion_tokens }}
                    </span>
                    <span class="trace-final__token trace-final__token--total">
                      total {{ item.event.usage.total_tokens }}
                    </span>
                  </p>

                  <details class="trace-final__details">
                    <summary>
                      完整 chunk · 已整合
                      {{ item.event.chunks?.length ?? 1 }} 条
                    </summary>
                    <pre class="trace-final__chunk">{{
                      JSON.stringify(item.response, null, 2)
                    }}</pre>
                  </details>
                </div>

                <details
                  v-if="item.event.type === 'tool_execute'"
                  class="trace-event__raw"
                >
                  <summary>查看工具参数</summary>
                  <pre>{{ formatArguments(item.event.arguments ?? "") }}</pre>
                </details>

                <details
                  v-if="item.event.type === 'tool_result' && item.event.content"
                  class="trace-event__raw"
                >
                  <summary>查看工具结果</summary>
                  <pre>{{ item.event.content }}</pre>
                </details>

                <details class="trace-event__raw">
                  <summary>查看原始事件</summary>
                  <pre>{{ JSON.stringify(item.event, null, 2) }}</pre>
                </details>
              </div>
            </li>
          </ol>

          <p v-else class="trace-panel__status">暂无轨迹事件</p>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.trace-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.32);
  backdrop-filter: blur(2px);
}

.trace-panel {
  display: flex;
  flex-direction: column;
  width: min(560px, 100vw);
  height: 100%;
  background: var(--panel);
  box-shadow: -20px 0 60px rgba(37, 70, 140, 0.18);
  animation: trace-slide-in 0.2s ease-out;
}

.trace-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border);
}

.trace-panel__heading {
  min-width: 0;
}

.trace-panel__heading h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.trace-panel__id {
  margin: 4px 0 0;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-panel__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.trace-panel__count {
  padding: 3px 9px;
  font-size: 11px;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid #d6e2ff;
  border-radius: 999px;
}

.trace-panel__close {
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--muted);
  font-size: 18px;
  line-height: 1;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}

.trace-panel__close:hover {
  color: var(--text);
  background: var(--surface-soft);
}

.trace-panel__body {
  flex: 1;
  padding: 18px 20px 24px;
  overflow-y: auto;
}

.trace-panel__status {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.trace-panel__status--error {
  color: var(--danger);
}

.trace-timeline {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.trace-timeline::before {
  content: "";
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 6px;
  width: 1px;
  background: var(--border);
}

.trace-event {
  --trace-color: var(--muted);

  position: relative;
  padding-left: 26px;
}

.trace-event--user {
  --trace-color: #4f7cff;
}

.trace-event--model_request {
  --trace-color: #7b5cff;
}

.trace-event--model_response {
  --trace-color: #15803d;
}

.trace-event--tool_call {
  --trace-color: #d97706;
}

.trace-event--tool_execute {
  --trace-color: #ea580c;
}

.trace-event--tool_result {
  --trace-color: #0e7490;
}

.trace-event__dot {
  position: absolute;
  top: 10px;
  left: 1px;
  width: 11px;
  height: 11px;
  background: var(--trace-color);
  border: 2px solid var(--panel);
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--border);
}

.trace-event__card {
  padding: 10px 12px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 12px;
}

.trace-event__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.trace-event__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--trace-color);
}

.trace-event__round {
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 500;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.trace-event__meta {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 8px;
}

.trace-event__duration {
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 600;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 999px;
}

.trace-event__time {
  flex: 0 0 auto;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent-strong);
  background: var(--accent-soft);
  border: 1px solid #d6e2ff;
  border-radius: 999px;
}

.trace-event__summary {
  margin: 5px 0 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-final {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.trace-final__label {
  margin: 0 0 4px;
  font-size: 10px;
  color: var(--muted);
}

.trace-final__tool {
  margin-top: 6px;
}

.trace-final__tool-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--trace-color);
}

.trace-final__tool pre {
  max-height: 160px;
  margin: 4px 0 0;
  padding: 6px 8px;
  overflow: auto;
  font-size: 10px;
  line-height: 1.5;
  color: var(--muted);
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.trace-final__usage {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 8px 0 0;
}

.trace-final__token {
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 600;
  border: 1px solid transparent;
  border-radius: 999px;
}

.trace-final__token--prompt {
  color: var(--accent-strong);
  background: var(--accent-soft);
  border-color: #d6e2ff;
}

.trace-final__token--completion {
  color: var(--success);
  background: var(--success-soft);
  border-color: #bbf7d0;
}

.trace-final__token--total {
  color: #7b5cff;
  background: #f1edff;
  border-color: #ddd3ff;
}

.trace-final__details {
  margin-top: 8px;
}

.trace-final__details summary {
  font-size: 10px;
  color: var(--muted);
  cursor: pointer;
}

.trace-final__chunk {
  max-height: 320px;
  margin: 6px 0 0;
  padding: 8px;
  overflow: auto;
  font-size: 10px;
  line-height: 1.5;
  color: var(--text);
  white-space: pre;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.trace-event__raw {
  margin-top: 6px;
}

.trace-event__raw summary {
  font-size: 10px;
  color: var(--muted);
  cursor: pointer;
}

.trace-event__raw pre {
  max-height: 240px;
  margin: 6px 0 0;
  padding: 8px;
  overflow: auto;
  font-size: 10px;
  line-height: 1.5;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
}

@keyframes trace-slide-in {
  from {
    opacity: 0;
    transform: translateX(24px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@media (max-width: 820px) {
  .trace-panel {
    width: 100%;
  }
}
</style>
