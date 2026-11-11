# 上下文管理设计说明：问题、方案与业界实践

> 项目：openai-agent-lab
> 状态：设计已落地到服务端（`server/src`）；持久化与前端会话 UI 仍待实施
> 制定日期：2026-10-21
> 关联执行计划：[CONTEXT_MANAGEMENT_PLAN.md](CONTEXT_MANAGEMENT_PLAN.md)
> 实施说明：[server/ARCHITECTURE.md](server/ARCHITECTURE.md)
> 实际目录：[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)
> 面向：正在学习 Agent 的项目开发者

## 0. 文档定位

- **本文回答「为什么这样设计」**：问题本质、设计理念、前后端边界、框架结构、方案优缺点、业界对比、未来预留。
- **执行计划回答「怎么一步步做」**：阶段、任务、验收标准。
- 两者配合阅读：先看本文建立判断力，再看计划落地。

## 1. 问题重述

### 1.1 现象

重构前，多轮对话中前端会把最近 20 条历史消息一起发给后端：

```text
第 1 轮: [user1]
第 2 轮: [user1, assistant1, user2]
第 3 轮: [user1, assistant1, user2, assistant2, user3]
...
```

代码位置：

- 前端 [useChatStream.ts](web/src/composables/useChatStream.ts) 的 `buildApiMessages()`
- 重构前，服务端 `server/src/routes/chat.ts` 是无状态的，只负责追加 system prompt 并转发模型；重构后对应 [server/src/api/chat.ts](server/src/api/chat.ts)

结果是 payload 随轮次线性增长，`prompt_tokens`、成本、延迟一起增长，最终会撞上模型上下文窗口。

### 1.2 根因

不是「消息数组写法不对」，而是**会话状态没有明确的归属**：

- 前端既负责展示，又负责保存历史、决定模型上下文。
- 后端完全无状态，不掌握上下文选择权。
- 没有预算、没有压缩、没有持久化。

### 1.3 三层模型

| 层 | 位置 | 本次设计中的角色 |
| --- | --- | --- |
| 传输 Payload | Web → Server | 只放 `conversationId` + 当前消息 |
| 模型上下文 | Server → Model | 由 Context Builder 按预算生成 |
| 会话记忆 | 存储层 | 历史消息、摘要、未来用户偏好 |

**关键认知：三层的优化目标不同。**

- 减少 payload 不等于减少模型 Token。
- 把历史搬到服务端，如果仍然全量发给模型，成本和上下文窗口压力不变。
- 真正需要设计的是「这次给模型看什么」，也就是上下文工程（Context Engineering）。

### 1.4 需求优先级

| 优先级 | 需求 |
| --- | --- |
| P0 | 前端 payload 只包含当前用户消息 |
| P1 | 多轮对话仍有记忆 |
| P2 | 模型上下文可控，不随轮次无限增长 |
| P3 | 会话可新建、切换、恢复、删除 |
| P4 | 为未来用户系统 / Tools / Skills / ReAct 留出扩展点 |

### 1.5 当前非目标

- 用户系统与鉴权
- 用户偏好提示词
- 工具调用、Skills、ReAct
- 长期记忆与 RAG

这些会在第 8 节说明如何预留，但不在本轮实施。

## 2. 设计理念（为什么这样设计）

### 2.1 状态与传输分离

**原则**：HTTP 聊天接口保持无状态，会话状态放入独立存储。

**体现**：`POST /api/chat` 只负责一次交互；`Conversation Store` 负责历史。

**理由**：

- 服务可重启、可水平扩展、可测试。
- 同一套接口可以服务 Web、移动端、CLI。
- 会话状态与传输协议解耦，未来换 SSE / WebSocket 不影响存储。

### 2.2 单一事实来源（Single Source of Truth）

**原则**：会话历史只由服务端保存，前端只做渲染与缓存。

**理由**：

- 避免「前端以为的历史」和「服务端以为的历史」不一致。
- 刷新、换设备、多标签页时行为一致。
- 上下文策略只实现一次，不需要每个客户端各写一套。

### 2.3 上下文是有限预算

**原则**：把上下文窗口当作预算来分配，而不是「能塞多少塞多少」。

```text
上下文窗口
├── System Prompt（稳定）
├── 会话摘要（长期要点）
├── 最近对话（短期细节）
├── 当前用户消息
└── 输出预留
```

**体现**：`Context Builder`、`CONTEXT_MAX_TOKENS`、`CONTEXT_RESERVE_OUTPUT`。

### 2.4 策略可替换

**原则**：上下文选择是一个可替换的策略，而不是写死在路由里。

```ts
interface ContextStrategy {
  build(input: ContextInput): Promise<ContextResult>;
}
```

先实现 `FullHistory`（兼容）、`SlidingWindow`，再实现 `SummaryWindow`，未来加 `RAG`。路由只依赖接口。

### 2.5 渐进式演进

**原则**：每一步都能独立上线、验证、回滚。

路线：

```text
单条直传 → 服务端会话 → 滑动窗口 → 滚动摘要 → 持久化
```

而不是一次性做完「用户系统 + Tools + ReAct + RAG」。

### 2.6 可观测性优先

**原则**：上下文管理如果没有度量，就无法判断对错。

需要记录：

- 本次包含/丢弃了多少条消息
- 估算 Token 与实际 `prompt_tokens`
- 是否使用摘要
- 首 Token 延迟、总耗时

### 2.7 为 Agent 预留

**原则**：消息模型不要只考虑聊天。

未来会出现：

- `system` / `tool` 角色
- 工具调用与观察结果
- ReAct 中间步骤
- 多模态内容
- 用户偏好与长期记忆

所以数据模型要预留 `metadata`、`status`、`usage`、`summary`、`userId` 等字段，避免未来大改表结构。

### 2.8 信任边界与安全

**原则**：客户端输入、模型输出、检索内容都不可信。

- 前端渲染 Markdown 必须消毒（当前已用 DOMPurify）。
- 服务端校验所有输入，限制长度与条数。
- 未来用户偏好要结构化存储，不要把用户原文直接拼进 system prompt。
- 未来 RAG 内容要标注来源与信任级别，防提示词注入。

### 2.9 成本意识

- 稳定的 system prompt 前缀有利于 Prompt 缓存。
- 不要每轮把完整历史重新传给模型。
- 摘要只在必要时触发，避免每轮都调用一次摘要模型。
- 记录 usage，按会话/用户做成本归因。

### 2.10 设计决策与理念的对应关系

| 决策 | 背后的理念 |
| --- | --- |
| 前端只传当前消息 | 传输与状态分离 |
| 服务端保存会话 | 单一事实来源 |
| 先窗口后摘要 | 先用确定性、低成本策略 |
| 保留旧 `messages` 接口 | 兼容与可对比实验 |
| 上下文统计写日志 | 可观测性 |
| 消息预留 metadata/usage/status | Agent 扩展性 |
| 先内存后 SQLite | 渐进式演进、降低初期复杂度 |

## 3. 前端怎么处理

### 3.1 职责边界

| 职责 | 前端负责 | 说明 |
| --- | --- | --- |
| 展示消息 | 是 | 用户/助手气泡、Markdown、流式光标 |
| 当前输入 | 是 | 输入框、Enter/Shift+Enter |
| conversationId | 是 | 保存在 localStorage，随请求发送 |
| 完整历史 | 否 | 服务端是事实来源，前端只缓存用于渲染 |
| 上下文选择 | 否 | 不决定给模型看哪些消息 |
| Token 预算 | 否 | 由服务端统一控制 |
| 会话创建/删除 | 调用接口 | UI 触发，服务端执行 |
| 流式解析 | 是 | fetch + ReadableStream + SSE 缓冲 |
| 中断 | 是 | 调用 abort 接口，或断开 fetch |
| 错误展示 | 是 | HTTP / SSE error / 连接中断 |

### 3.2 立即方案（Phase 1，未采用）

> 实际实施跳过了单条直传，直接完成 Phase 2 的 session 模式；本节保留作为对比实验方案。

把历史构造逻辑从：

```ts
const apiMessages = buildApiMessages(); // 最近 20 条
```

改为：

```ts
const apiMessages: ApiChatMessage[] = [
  { role: "user", content: text },
];
```

效果：

- payload 永远只有 1 条消息。
- 模型失去多轮记忆。
- 适合验证「payload 是否真的变小」，不是最终形态。

### 3.3 目标方案（Phase 2+，已实现）

> 当前 Web 已按本节实现：请求只带 `conversationId` + 当前消息，历史由服务端维护。

```ts
await sendChatStream({
  conversationId,
  message: text,
  stream: true,
});
```

前端本地只保留：

- `conversationId`
- 当前页面用于渲染的消息缓存（可与服务端一致）
- UI 状态：streaming / aborted / error

刷新恢复流程：

```text
读取 localStorage.conversationId
        ↓
GET /api/conversations/:id
        ↓
用服务端消息重建页面
```

### 3.4 前端反模式

- ❌ 继续维护完整历史并每轮发送
- ❌ 前端自己实现摘要/截断，导致不同客户端策略不一致
- ❌ 把模型输出直接 `v-html`（必须消毒）
- ❌ 中断时只删 UI，不通知服务端（会继续计费）
- ❌ 与会话状态相关的逻辑散落在多个组件

## 4. 后端怎么处理

### 4.1 职责边界

| 职责 | 说明 |
| --- | --- |
| 会话 CRUD | 创建、读取、删除、列表（未来） |
| 消息持久化 | user/assistant 消息、状态、usage |
| 上下文构建 | system + summary + 窗口 + 当前消息 |
| Token 预算 | 估算、截断、预留输出 |
| 摘要生成 | 超阈值时压缩旧消息 |
| 模型调用 | 流式转发、中断传播 |
| 并发控制 | 同一会话串行化或 409 |
| 幂等 | 基于 requestId 去重 |
| 可观测性 | context stats、耗时、错误 |
| 安全 | 校验、权限、限流（未来） |

### 4.2 会话聊天流程

```text
Web                         Server                          Store              Model
 │  POST /api/chat           │                                │                  │
 │  {conversationId, msg} ─▶ │                                │                  │
 │                           │ 校验 + 会话归属检查             │                  │
 │                           │ 追加 user 消息 ───────────────▶ │                  │
 │                           │ 读取历史 ─────────────────────▶ │                  │
 │                           │ Context Builder 选消息           │                  │
 │                           │ 调用模型 ────────────────────────────────────────▶ │
 │ ◀──── SSE delta ───────── │                                │                  │
 │ ◀──── SSE done ────────── │ 追加 assistant 消息 ──────────▶ │                  │
 │                           │ 记录 usage / context stats      │                  │
```

### 4.3 Context Builder 算法

```ts
function buildContext(input: ContextInput): ContextResult {
  const systemTokens = estimate(input.systemPrompt);
  const currentTokens = estimate(input.currentMessage);
  let budget =
    input.maxContextTokens - systemTokens - currentTokens - input.reserveOutputTokens;

  const selected: LlmMessage[] = [];
  let dropped = 0;

  // 从新到旧，以 user/assistant 对为单位
  for (const pair of pairsNewestFirst(input.history)) {
    if (pair.some((m) => m.status !== "done")) continue;
    const cost = estimateMany(pair);
    if (cost > budget) {
      dropped += pair.length;
      continue; // 或 break，取决于策略
    }
    selected.unshift(...pair);
    budget -= cost;
  }

  return {
    messages: [
      { role: "system", content: input.systemPrompt },
      ...(input.summary ? [{ role: "system", content: `历史摘要：${input.summary}` }] : []),
      ...selected,
      { role: "user", content: input.currentMessage },
    ],
    stats: {
      includedMessages: selected.length,
      droppedMessages: dropped,
      estimatedTokens: input.maxContextTokens - budget,
      summaryUsed: Boolean(input.summary),
    },
  };
}
```

关键规则：

1. system prompt 与当前用户消息永远保留。
2. 历史从新到旧加入。
3. 保持 user/assistant 配对，不产生孤儿 assistant。
4. 超预算立即停止（或按策略跳过超大历史）。
5. `error` / `aborted` 默认不进入上下文。
6. 摘要只保留要点，不替代最近窗口。

### 4.4 会话生命周期

```text
创建会话 → 多轮消息 → 触发摘要 → 继续对话 → 删除/过期
```

- 新建会话：生成新 ID，清空上下文。
- 重置会话：等价于新建会话（保留旧会话供审计）。
- 删除会话：删除消息与摘要；未来需考虑软删除与保留期。
- 并发：同一会话同一时刻只允许一个生成请求；否则返回 409 或排队。
- 中断：记录部分 assistant 消息，状态 `aborted`，默认不进入后续上下文。
- 幂等：同一 `requestId` 重试不重复写入消息。

### 4.5 后端反模式

- ❌ 无状态服务端 + 客户端全量历史（重构前）
- ❌ 无条件把会话全部历史发给模型
- ❌ 在路由里临时拼上下文，策略散落
- ❌ 摘要无限增长
- ❌ 不做并发控制，消息交错
- ❌ 中断后仍把半截回答当正常历史
- ❌ 日志只记录文本，不记录 token/上下文统计

## 5. 框架与模块设计

### 5.1 分层

```text
┌──────────────────────────────────────────────┐
│ Web（Vue）                                    │
│ 展示 / 输入 / SSE 解析 / conversationId 管理   │
└──────────────────────┬───────────────────────┘
                       │ HTTP + SSE
┌──────────────────────▼───────────────────────┐
│ API 层（Express routes）                      │
│ 校验、鉴权、SSE 生命周期、错误映射              │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│ Application 层（services）                    │
│ ChatService / ConversationService            │
│ ContextBuilder / Summarizer                  │
└───────────────┬──────────────────┬───────────┘
                │                  │
┌───────────────▼──────┐  ┌────────▼───────────┐
│ Domain               │  │ Infrastructure      │
│ Conversation/Message │  │ Repository / LLM    │
│ ContextPolicy        │  │ Tokenizer / Logger  │
└───────────────┬──────┘  └────────┬───────────┘
                │                  │
        ┌───────▼───────┐  ┌───────▼──────────┐
        │ In-memory     │  │ DeepSeek/OpenAI  │
        │ SQLite/Redis  │  │ SDK              │
        └───────────────┘  └──────────────────┘
```

### 5.2 实际模块划分

设计稿最初按 `routes / services / repositories / domain` 分层。落地时收敛为**按业务能力分模块**，减少跨层跳转，同时保持单向依赖。详细职责见 [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)。

```text
server/src/
├── api/           # 路由、zod 校验、SSE、日志、中断、会话锁
├── ai/            # OpenAI Client、completeChat/streamChat、输出映射
├── context/       # 上下文类型、策略、预算、选择、组装
│   ├── context.types.ts
│   ├── context.policy.ts
│   ├── context.budget.ts
│   ├── context.selector.ts
│   └── context.builder.ts
├── conversation/  # 会话 CRUD、Repository、消息持久化、摘要、单轮编排
├── memory/        # 长期记忆提取、存储、召回
├── knowledge/     # 文档加载、分块、BM25、引用
├── agent/         # Agent 循环与工具注册骨架
├── config/env.ts
└── lib/           # 错误与文本工具
```

依赖方向：

```text
api → conversation → context / ai / memory / knowledge
```

`context/` 只做纯计算，不读存储、不调用模型；`ai/` 不知道会话与上下文的存在。

### 5.3 关键接口

实际实现采用函数式模块；下面是等价的接口草图。

```ts
interface ConversationRepository {
  create(input: CreateConversationInput): Promise<Conversation>;
  get(id: string): Promise<Conversation | null>;
  list(options: { userId?: string; limit: number }): Promise<ConversationSummary[]>;
  update(id: string, patch: ConversationPatch): Promise<Conversation | null>;
  appendMessage(id: string, message: ConversationMessage): Promise<Conversation | null>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
}

type ContextStrategy = {
  name: "full" | "window" | "summary-window";
  includeSummary: boolean;
  maxHistoryMessages(policy: ContextPolicy): number;
};

type LlmClient = {
  completeChat(
    messages: LlmMessage[],
    options?: LlmRequestOptions,
  ): Promise<LlmCompletionResult>;
  streamChat(
    messages: LlmMessage[],
    options?: LlmRequestOptions,
  ): AsyncGenerator<LlmStreamEvent>;
};

type TokenEstimator = (text: string) => number;
```

依赖方向：

- API → 单轮编排（`conversation/chat.service.ts`）→ Repository / Context Builder / Memory / Knowledge / AI
- 不反向依赖；换存储只改 Repository 实现。

### 5.4 配置

```text
CONTEXT_STRATEGY=window          # full | window | summary-window
CONTEXT_MAX_TOKENS=8000          # 按模型实际窗口调整
CONTEXT_MAX_MESSAGES=20
CONTEXT_RESERVE_OUTPUT=1024
CONTEXT_SUMMARY_THRESHOLD=0.6    # 占预算比例
CONTEXT_SUMMARY_KEEP_TURNS=4
CONTEXT_SUMMARY_MAX_TOKENS=800
CONTEXT_SYSTEM_PROMPT=           # 留空使用内置 prompt

MEMORY_ENABLED=false
MEMORY_LIMIT=5
MEMORY_BUDGET_RATIO=0.15

KNOWLEDGE_DIR=                   # 留空表示不启用
KNOWLEDGE_TOP_K=4
KNOWLEDGE_BUDGET_RATIO=0.25
```

完整列表见 [server/ARCHITECTURE.md](server/ARCHITECTURE.md#13-配置说明)。

### 5.5 API 兼容策略

| 模式 | 请求 | 状态 |
| --- | --- | --- |
| legacy / stateless | `{ messages: [...] }` | 已实现，保留用于兼容与对比 |
| session | `{ conversationId?, message }` | 已实现；服务端与 Web 均已使用，省略 ID 自动创建会话 |
| single | `{ messages: [当前一条] }` | 不是独立模式，等价于 stateless 只传一条 |

校验规则：`message` 与 `messages` 必须且只能提供一个；`conversationId` 只能与 `message` 一起使用；stateless 的最后一条必须是 `user`。

## 6. 方案对比与优缺点

### 6.1 方案矩阵

| 方案 | payload | 模型上下文 | 多轮记忆 | 一致性 | 成本控制 | 复杂度 |
| --- | --- | --- | --- | --- | --- | --- |
| A 单条直传 | 最小 | 当前 1 条 | 无 | 高 | 最好 | 最低 |
| B 客户端全量历史（现状） | 线性增长 | 全量 | 有 | 低 | 差 | 低 |
| C 服务端会话 + 全量 | 最小 | 全量 | 有 | 高 | 差 | 中 |
| D 服务端会话 + 窗口 | 最小 | 最近 N 条 | 近期 | 高 | 好 | 中 |
| E 服务端会话 + 摘要 | 最小 | 摘要 + 最近 N 条 | 长期要点 | 高 | 好 | 较高 |
| F 客户端摘要 | 小 | 摘要 + 当前 | 部分 | 低 | 中 | 中 |
| G 供应商原生压缩 | 最小 | 供应商管理 | 取决于实现 | 中 | 好 | 低（接入） |

### 6.2 推荐方案（D → E）的优点

- 前端 payload 恒定，不随轮次增长。
- 多轮记忆保留，体验优于单条直传。
- 上下文策略集中在服务端，Web/移动/CLI 行为一致。
- 可以精确控制 Token 预算，避免上下文溢出。
- 可观测：能记录包含/丢弃/摘要使用情况。
- 易扩展：未来用户偏好、Tools、ReAct 都走同一套上下文构建。
- 服务端可以统一做安全、权限、限流、成本归因。
- 更换模型或压缩策略时，前端无需改动。

### 6.3 推荐方案的缺点

| 缺点 | 说明 | 缓解 |
| --- | --- | --- |
| 引入服务端状态 | 需要存储、恢复、清理 | Repository 抽象；先内存后 SQLite |
| 并发一致性 | 同会话并发写会交错 | 会话级锁 / 409 / 队列 |
| 隐私与合规 | 服务端保存对话内容 | 保留期、删除接口、脱敏、未来鉴权 |
| 摘要是有损的 | 远期细节可能丢失 | 保留最近窗口；摘要保留事实/偏好/待办 |
| Token 估算误差 | 中文/代码/工具输出难精确 | 保守估算 + 用实际 usage 校准 |
| 多实例扩展 | 内存存储无法共享 | Redis/DB 作为共享存储 |
| 增加 API 面 | 会话 CRUD、加载历史 | 前端统一封装；保留兼容接口 |
| Prompt 缓存受影响 | 上下文动态变化 | 稳定 system 前缀；缓存友好排序 |
| 服务端可能仍然过度发送 | 策略实现不当 | 预算测试、日志、评估集 |

### 6.4 其他方案的主要优缺点

**A 单条直传**

- 优点：最简单；payload 最小；无状态；隐私最好。
- 缺点：没有记忆；追问失效；不是完整产品形态。
- 适合：一次性问答、严格隐私场景、对比实验。

**B 客户端全量历史（现状）**

- 优点：实现简单；服务端无状态；离线可用。
- 缺点：payload 与 Token 线性增长；客户端可篡改上下文；多端不一致；无法统一预算。
- 适合：原型、单用户、短对话。

**C 服务端会话 + 全量历史**

- 优点：payload 小；有记忆；集中管理。
- 缺点：模型 Token 仍然增长，没解决窗口问题。
- 适合：短会话、内部工具。

**F 客户端摘要**

- 优点：payload 较小；实现比服务端会话轻。
- 缺点：摘要质量依赖客户端；刷新/多端不一致；难以审计。
- 适合：纯前端、无后端存储的轻量应用。

**G 供应商原生压缩**

- 优点：接入简单；由供应商优化；可能更省 Token。
- 缺点：黑盒/加密状态、供应商锁定、可迁移性差、调试困难。
- 适合：深度绑定单一模型供应商、对可解释性要求不高的场景。

## 7. 业界对比：Claude Code / Codex / Qwen

> 说明：以下基于公开文档与社区源码分析整理，产品迭代很快，具体阈值/行为以官方最新文档为准。

### 7.1 对比总表

| 维度 | Claude Code | OpenAI Codex | Qwen Code / Qwen-Agent | 本项目建议 |
| --- | --- | --- | --- | --- |
| 形态 | 本地 CLI / 云端 | CLI / 云端 | CLI / 开源框架 | Web + Server |
| 历史存放 | 本地 JSONL transcript | 本地会话 + 服务端/加密 compaction | 本地 session JSONL | 服务端会话存储 |
| 每轮发送 | 当前工作上下文（历史 + 工具结果） | 无状态 input 或 `previous_response_id` | 压缩快照 + 后续轮次 | `conversationId` + 当前消息 |
| 压缩触发 | 接近窗口上限自动 compact；手动 `/compact` | `auto_compact_limit` / `compact_threshold` | 约 70% 窗口，可配置 | 预算阈值 → 窗口 → 摘要 |
| 压缩产物 | 摘要 + 重新注入 memory/文件/skills | 加密 compaction item / 可见 handoff summary | 结构化 XML 快照 | 摘要 + 最近窗口 |
| 工具输出管理 | 旧的大工具结果优先清理（社区分析） | 先截断工具输出再压缩 | S1–S5 渐进裁剪 | 未来 ReAct 时实现 |
| 长期记忆 | CLAUDE.md + auto memory | AGENTS.md + Memory | QWEN.md + auto-memory + RAG | 未来用户画像/记忆 |
| 会话恢复 | `--resume` / `--continue` / `--fork-session` | 会话/压缩项续接 | `qwen --resume <id>` | `GET /api/conversations/:id` |
| 设计取向 | 本地优先、透明、可恢复 | 无状态 HTTP、供应商原生压缩 | 渐进裁剪 + 结构化快照 | 服务端集中策略、可观测 |

### 7.2 Claude Code

**状态与恢复**

- 会话以 append-only JSONL 保存在 `~/.claude/projects/<project>/<session-id>.jsonl`。
- 支持 `--continue`、`--resume`、`--fork-session`，子 Agent 的 transcript 也独立存放。
- 这体现的是**本地优先**：历史归用户所有，服务端 API 保持无状态。

**上下文管理**

- 接近上下文上限时自动 compact，机制与手动 `/compact` 相同；也支持 `/clear` 新任务、`/rewind` 回退。
- 压缩后不是「全部丢失」：system prompt、CLAUDE.md、auto memory、plan、技能说明等会重新注入；最近修改的文件可能被重新读取。
- 社区源码分析描述了更细的分层：先清理旧的大工具结果，再用 session memory 摘要，最后回退到完整摘要。该细节属于社区分析，不是官方 API 承诺。
- 子 Agent 使用独立上下文窗口，只把结论/报告返回父 Agent，避免大段工具输出污染主上下文。
- 使用 Prompt 缓存降低重复前缀成本，并提供 `/usage` 观察 Token。

**设计理念**

- 上下文不是「越多越好」，而是**主动策展**：保留目标、决策、约束与最近证据，丢弃可重新获取的工具输出。
- 本地 transcript 保证可恢复、可审计；压缩是有损的，但可以手动指定压缩重点。
- 子 Agent 是最有效的上下文隔离手段之一。

**对我们的启发**

- 会话恢复、fork、结构化摘要、子上下文隔离值得借鉴。
- 本地优先适合 CLI；Web 产品更需要服务端会话，但可以保留「导出/恢复」能力。

### 7.3 OpenAI Codex

**供应商原生压缩**

- OpenAI Responses API 提供 compaction：通过 `context_management: [{ type: "compaction", compact_threshold: N }]` 在服务端流式压缩，返回 compaction item。
- 支持两种续接方式：
  - 无状态 input 数组：把输出项（包括 compaction item）追加到下一次输入。
  - `previous_response_id`：每轮只传新用户消息，由服务端保留状态。
- 也提供独立的 `/responses/compact` 端点，返回可复用的压缩窗口。

**Codex 的取舍**

- 公开的 agent loop 介绍指出，Codex 倾向于避免 `previous_response_id`，保持 HTTP 请求无状态、兼容 ZDR（零数据保留），用加密的 `encrypted_content` 承载状态。
- 自动压缩在超过 `auto_compact_limit` 时触发；压缩前先限制单个工具输出的大小（head/tail + 行数提示）。
- 本地压缩会产生一个可见的「CONTEXT CHECKPOINT COMPACTION」交接摘要，要求模型总结进展、决策、约束、剩余步骤；压缩后摘要替换活跃历史。
- AGENTS.md 作为项目规则在每次请求中重新注入，不依赖历史保留。

**设计理念**

- 把 compaction 做成**协议能力**，而不是客户端自己拼历史。
- 状态可以是不透明的加密块，换取无状态 HTTP 与隐私兼容。
- 工具输出先截断、再压缩，避免「垃圾进上下文」。

**对我们的启发**

- 阈值触发、结构化交接摘要、工具输出上限都值得借鉴。
- 供应商原生压缩可减少代码，但 DeepSeek/OpenAI 兼容 Chat Completions 没有同等能力；自研 Context Builder 更可控、可迁移。
- 如果未来切到 Responses API，可以让 ContextStrategy 走供应商 compaction，作为另一种实现。

### 7.4 Qwen Code / Qwen-Agent

**Qwen Code（CLI）**

- 会话保存在本地 `~/.qwen/sessions/<uuid>/`，包含 `conversation.jsonl`、checkpoint、metadata；支持 `qwen --resume <id>`。
- 上下文压缩默认在 prompt token 超过约 70% 窗口时触发（可配置），生成结构化 XML `<conversation_snapshot>`，包含 context / progress / pending / errors，Token 可下降约 50–80%。
- `/context` 可以按来源拆解上下文占用：system prompt、内置工具、MCP 工具、memory 文件、Skills、扩展文件。
- QWEN.md 分层加载：全局 → 项目根 → 中间目录 → 当前目录 → 扩展上下文文件；支持 `@import`。
- auto-memory 存在 `~/.qwen/projects/<project>/memory/`，由 MEMORY.md 索引，支持清理与团队记忆。

**Qwen-Agent（框架）**

- 按 `max_input_tokens` 动态裁剪，采用 S1–S5 渐进策略：
  1. 丢弃最老的完整对话轮次
  2. 压缩最老的 tool 响应
  3. 丢弃最老的 tool-call 步骤
  4. 逐步折叠最近一步的 tool 响应
  5. 截断用户 query 或最终回复
- Memory/RAG 模块支持文档解析、BM25/向量/混合检索；长文档场景采用「关键词 RAG → 分块相关性过滤 → ReAct 多跳」的渐进方案。

**设计理念**

- 先做**确定性裁剪**，再做摘要；工具输出是重点裁剪对象。
- 用结构化快照保留「进展/待办/错误」，比自由文本摘要更稳定。
- 记忆文件（QWEN.md / auto-memory）与活跃上下文分离。

**对我们的启发**

- 结构化摘要格式（context/progress/pending/errors）很适合 Agent。
- `/context` 式的来源拆解非常适合本项目日志/调试面板。
- S1–S5 是未来接入工具后很好的裁剪顺序。

### 7.5 共同规律

1. **没有产品把无限历史原样发送**：要么窗口，要么压缩，要么检索。
2. **活跃上下文与长期记忆分离**：transcript/memory 文件不等于本次 prompt。
3. **工具输出是主要污染源**：先截断，再压缩。
4. **摘要需要结构**：目标、决策、约束、待办、错误，比自由摘要更可靠。
5. **会话可恢复是基本能力**：resume/fork/checkpoint。
6. **Prompt 缓存依赖稳定前缀**：system prompt/工具定义的顺序要稳定。
7. **子上下文隔离**：子 Agent 只回传结论，能显著降低主上下文压力。

### 7.6 我们该借什么、不该照搬什么

| 借鉴 | 原因 |
| --- | --- |
| 会话持久化 + 恢复 | Web 刷新/多端一致 |
| 阈值触发的窗口/摘要 | 可控、可观测 |
| 结构化摘要 | 比自由文本稳定 |
| 工具输出裁剪 | 未来 ReAct 必需 |
| `/context` 式来源统计 | 调试与成本归因 |
| 子 Agent 隔离 | 未来复杂任务 |

| 不照搬 | 原因 |
| --- | --- |
| 本地 JSONL 作为唯一存储 | Web 多端与服务端策略需要集中状态 |
| 供应商加密 compaction | 当前模型/接口不提供，且黑盒、锁定 |
| 固定 70%/90% 阈值 | 不同模型窗口与成本不同，应配置化 |
| 只做单条直传 | 失去多轮记忆，不是产品形态 |

## 8. 未来扩展的预留与铺垫

### 8.1 数据模型预留

| 字段 | 现在 | 未来用途 |
| --- | --- | --- |
| `Conversation.userId` | 可空 | 用户隔离、配额、审计 |
| `Conversation.metadata` | 可空 JSON | 标题、标签、场景、模型配置 |
| `Conversation.summary` | 可空 | 滚动摘要 |
| `Conversation.summaryVersion` | 可空 | 摘要策略升级/重建 |
| `Message.role` | user/assistant | 增加 system/tool |
| `Message.status` | done/aborted/error | 重试、上下文过滤 |
| `Message.usage` | 可空 | 成本归因 |
| `Message.model` | 可空 | 多模型对比 |
| `Message.promptVersion` | 可空 | Prompt 迭代追踪 |
| `Message.toolCalls` | 可空 | Tools/ReAct |
| `Message.metadata` | 可空 JSON | 来源、置信度、附件 |
| `traceId` | 可空 | 全链路观测 |

### 8.2 接口与抽象预留

- `ConversationRepository`：内存 → SQLite → Redis/Postgres 可替换。
- `ContextStrategy`：full → window → summary-window → RAG。
- `TokenEstimator`：字符估算 → tokenizer。
- `LlmClient`：DeepSeek/OpenAI 兼容 → 其他供应商。
- `Summarizer`：同步摘要 → 后台任务。
- `AuthMiddleware`：先留接口，后接用户系统。
- 功能开关：`CONTEXT_STRATEGY`、`CONTEXT_MODE`。

### 8.3 用户系统与用户偏好（未来）

- 用户表、会话归属、数据隔离。
- 用户偏好结构化存储：语言、格式、代码风格、禁用表达。
- 注入优先级：

```text
平台安全规则 > System Prompt > 用户偏好 > 历史对话 > 检索内容
```

- 用户偏好不作为原始文本直接拼接，降低提示词注入风险。

### 8.4 Prompt 管理（未来）

- 模板化、版本化、可回滚。
- `promptVersion` 记录到消息，便于对比效果。
- 稳定前缀有利于 Prompt 缓存。

### 8.5 Tools / Skills（未来）

- Tool Registry：名称、描述、JSON Schema、权限、超时。
- 动态工具选择，避免所有 schema 都进上下文。
- Skills = 说明 + 工具 + 示例，按需加载。
- 高风险工具人工确认。

### 8.6 ReAct（未来）

- 思考 → 行动 → 观察 → 继续/结束。
- 最大步数、总超时、重复调用检测。
- 上下文：保留目标、最近 K 步、关键观察摘要；旧工具输出裁剪。
- 不默认持久化完整思维链；保存结构化 trace。

### 8.7 记忆与 RAG（未来）

| 记忆类型 | 内容 | 生命周期 |
| --- | --- | --- |
| 短期 | 当前会话消息 | 会话级 |
| 长期 | 用户偏好、稳定事实 | 跨会话 |
| 情景 | 过去会话摘要 | 长期 |
| 语义 | 文档/知识库 RAG | 长期 |

需要写入、去重、过期、隐私策略。

### 8.8 可观测性与安全（未来）

- Trace：上下文组成、Token 分解、工具调用、耗时。
- 评估集：固定问题集回归测试上下文策略。
- 安全：提示词注入、工具越权、限流、PII 脱敏。

## 9. 风险与反模式

| 风险 | 表现 | 缓解 |
| --- | --- | --- |
| 状态漂移 | 前端显示与服务端历史不一致 | 服务端为 SSOT；刷新重载 |
| 重复写入 | 重试导致 user 消息重复 | requestId 幂等 |
| 并发交错 | 同会话两个请求互相覆盖 | 会话锁 / 409 / 队列 |
| 上下文溢出 | prompt 超模型窗口 | 预算 + 截断 + 预留输出 |
| 摘要漂移 | 关键细节被摘要丢掉 | 结构化摘要 + 最近窗口 + 评估集 |
| 摘要膨胀 | 摘要本身越来越长 | 摘要 Token 上限 + 定期重建 |
| Token 估算偏差 | 预算失真 | 保守估算 + usage 校准 |
| 缓存失效 | 动态上下文破坏前缀缓存 | 稳定 system/tool 顺序 |
| 隐私风险 | 服务端保存敏感对话 | 保留期、删除、加密、鉴权 |
| 供应商锁定 | 依赖加密 compaction | LlmClient/ContextStrategy 抽象 |
| 上下文投毒 | RAG/工具结果含恶意指令 | 来源标记、指令层级、隔离 |
| 过度压缩 | 模型失去必要细节 | 保留最近窗口与关键事实 |

## 10. 结论与建议

1. **已实现**：服务端会话 + Context Builder（`full / window / summary-window`）+ 滚动摘要 + 记忆/知识骨架。
2. **已实现**：`{ messages }` stateless 兼容；session 模式支持自动建会话、会话锁（409）与 `X-Conversation-Id`。
3. **待实施**：SQLite/Redis 持久化、用户系统与鉴权、向量知识库、Agent 工具循环、评估集。
4. **不要**：继续让前端维护完整历史并每轮发送；也不要把「历史搬到服务端」误当成「模型上下文变小」。
5. **先度量再优化**：记录 payload、消息条数、prompt_tokens、上下文统计与耗时。
6. **保持兼容**：保留 `{ messages }` stateless 模式，作为调试与对比入口。
7. **为未来留口**：Repository 异步接口、ContextStrategy 策略表、消息 metadata、userId、summary 版本。

一句话总结：

> **好的上下文管理不是「把更多历史塞给模型」，而是「在正确的时间，把正确的信息，以可承受的 Token 成本交给模型」。**

## 11. 参考资料

- Claude Code — Explore the context window: https://code.claude.com/docs/en/context-window
- Claude Code — Manage sessions: https://code.claude.com/docs/en/sessions
- Claude Code — Agent loop: https://code.claude.com/docs/en/agent-sdk/agent-loop
- OpenAI — Compaction guide: https://developers.openai.com/api/docs/guides/compaction
- OpenAI — Shell + Skills + Compaction（长任务 Agent 建议）: https://developers.openai.com/blog/skills-shell-tips
- OpenAI Codex — 官方仓库: https://github.com/openai/codex
- Qwen Code — Memory: https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/
- Qwen Code — Weekly update（压缩/上下文统计细节）: https://qwenlm.github.io/qwen-code-docs/zh/blog/updates/weekly-update-2026-09-24/
- Qwen-Agent — Context management: https://qwenlm.github.io/Qwen-Agent/en/guide/core_moduls/context/#management-strategy
- Qwen-Agent — Long-context RAG: https://qwenlm.github.io/blog/qwen-agent-2405/

> 注：Claude Code 的三层压缩细节、Codex 的本地压缩流程部分来自社区源码分析/技术文章，非官方 API 承诺；产品行为可能随版本变化。
