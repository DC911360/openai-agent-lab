# Server 架构说明（上下文工程版）

> 项目：openai-agent-lab
> 对应代码：`server/src`
> 最后更新：2026-10-21
> 状态：已实施（服务端会话 + 上下文工程 + 记忆/知识库骨架）
> 关联文档：
>
> - [项目说明](../README.md)
> - [项目目录](../PROJECT_STRUCTURE.md)
> - [上下文管理设计说明](../CONTEXT_MANAGEMENT_DESIGN.md)
> - [上下文与会话管理开发计划](../CONTEXT_MANAGEMENT_PLAN.md)
> - [学习笔记](NOTES.md)

---

## 1. 这次重构做了什么

旧版 server 是一个**无状态转发器**：前端每轮把最近 20 条历史一起发来，服务端只追加 system prompt 后转发给模型。它的问题不是接口写法，而是**会话状态和上下文选择权都在客户端**。

重构后，服务端承担三件事：

| 能力 | 归属模块 | 结果 |
| --- | --- | --- |
| 会话历史、消息状态、摘要 | `conversation/` | 服务端成为会话的唯一事实来源 |
| 本次请求到底给模型看什么 | `context/` | 按 Token 预算选择历史、摘要、记忆、知识 |
| 模型调用与输出协议 | `ai/` | 路由不再直接依赖 OpenAI SDK |

同时保留旧版 `{ messages: [...] }` 调用方式，用于兼容现有 Web 前端和对比实验。

### 1.1 旧结构 → 新结构映射

```text
routes/*                  → api/*                       HTTP 路由、校验、SSE
services/deepseek.ts      → ai/*                        模型 SDK 封装、请求参数、输出处理
types/chat.ts             → ai/ai.types.ts
                            api/chat.schema.ts
                            context/context.types.ts
types/log.ts              → api/log.types.ts
lib/sse.ts                → api/sse.ts
lib/active-requests.ts    → api/active-requests.ts
lib/log-store.ts          → api/log-store.ts
lib/logger.ts             → api/logger.ts
middleware/request-logger → api/request-logger.ts
新增                      → context/ conversation/ memory/ knowledge/ agent/
```

---

## 2. 目录结构

```text
server/src/
├── index.ts                     进程入口：初始化知识库、监听端口、优雅退出
├── app.ts                       Express 装配：中间件顺序、路由挂载、404/错误兜底
├── config/
│   └── env.ts                   dotenv + 环境变量读取与启动校验
├── api/                         HTTP 路由、请求参数校验、流式响应 SSE
│   ├── chat.ts                  聊天与中断接口的编排
│   ├── chat.schema.ts           session / stateless 两种请求的 zod schema
│   ├── conversations.ts         会话 CRUD
│   ├── conversation.schema.ts   会话接口 schema
│   ├── logs.ts                  请求/响应日志查询
│   ├── health.ts                健康检查与运行状态
│   ├── sse.ts                   SSE 响应头与事件帧
│   ├── validation.ts            统一 400 响应
│   ├── active-requests.ts       requestId → AbortController 注册表
│   ├── conversation-locks.ts    会话级并发锁（同一会话 409）
│   ├── request-logger.ts        requestId 生成、请求/响应日志
│   ├── log-store.ts             内存环形日志（200 条）
│   ├── log.types.ts             日志结构
│   └── logger.ts                预览截断、requestId/日志条目读取
├── ai/                          模型 SDK 封装、统一请求参数、模型输出处理
│   ├── client.ts                全进程共享的 OpenAI Client
│   ├── chat.ts                  completeChat / streamChat
│   └── ai.types.ts              LlmMessage / LlmUsage / LlmStreamEvent
├── context/                     核心：本次请求的上下文工程
│   ├── context.types.ts         上下文类型定义
│   ├── context.policy.ts        策略选择、默认 system prompt、策略解析
│   ├── context.budget.ts        Token 估算、预算、截断
│   ├── context.selector.ts      历史/记忆/知识的选择与排序
│   └── context.builder.ts       上下文组装与统计
├── conversation/                会话管理、消息持久化、历史加载与摘要
│   ├── conversation.types.ts    会话/消息领域模型
│   ├── conversation.repository.ts  Repository 接口 + 内存实现
│   ├── conversation.service.ts  会话 CRUD、追加消息、更新摘要
│   ├── conversation.summary.ts  阈值触发、滚动摘要、结构化摘要
│   └── chat.service.ts          一次对话的准备、持久化与后置副作用
├── memory/                      长期记忆的提取、存储、查询与更新
│   ├── memory.types.ts          记忆类型
│   ├── memory.store.ts          内存记忆库 + 去重 + 召回
│   ├── memory.extractor.ts      用小模型从一轮对话中提取记忆
│   └── memory.service.ts        召回与后台写入
├── knowledge/                   文档加载、检索与引用来源管理
│   ├── knowledge.types.ts       文档/分块/检索结果
│   ├── knowledge.loader.ts      递归加载、分块
│   ├── knowledge.store.ts       BM25 索引
│   ├── knowledge.retriever.ts   检索入口
│   └── knowledge.service.ts     初始化、检索、引用数据
├── agent/                       后续扩展：工具调用循环、任务状态、终止条件
│   ├── agent.types.ts           AgentStep / AgentState / 终止原因
│   ├── agent.registry.ts        工具注册表与超时执行
│   └── agent.loop.ts            步数/超时/中断/终止骨架
├── tools/                       可复用工具
│   └── web-fetch/
│       ├── web-fetch.ts         http / browser / auto 网页抓取
│       ├── types.ts             输入输出类型
│       ├── web-fetch.test.ts    tsx 示例脚本
│       └── web-fetch.md         工具说明
└── lib/                         跨模块纯工具
    ├── errors.ts                带 HTTP 状态码的业务错误
    └── text.ts                  归一化、中文二元组分词、截断
```

`api / ai / context / conversation / memory / knowledge / agent` 就是本次改造的主结构；`config`、`lib`、`app.ts`、`index.ts` 是支撑目录，不参与业务语义。

---

## 3. 分层与依赖方向

```text
index.ts
  └─▶ app.ts
        ├─▶ api/* ──────────────▶ conversation/chat.service.ts
        │                              ├─▶ conversation/*   （会话与摘要）
        │                              ├─▶ context/*        （上下文组装）
        │                              ├─▶ memory/*         （长期记忆）
        │                              ├─▶ knowledge/*      （知识库）
        │                              └─▶ ai/*             （模型调用）
        ├─▶ api/log-store.ts
        └─▶ config/env.ts

agent/*  ── 独立骨架，当前未被路由引用，未来接入 ai/ 与工具执行
lib/*    ── 只被其他模块依赖，不依赖业务模块
```

依赖规则：

1. **`api/` 不直接调用 OpenAI SDK**，只依赖 `ai/` 与 `conversation/`。
2. **`context/` 不读数据库、不调用模型**，只做纯计算，方便单测。
3. **`conversation/` 是唯一写会话的地方**，Repository 可替换为 SQLite/Redis。
4. **`ai/` 不知道会话、上下文、记忆的存在**，只接收 `messages`。
5. **`memory/`、`knowledge/` 不反向依赖 `conversation/`**，只向上下文层提供结构化素材。
6. **`agent/` 是未来扩展点**，不与当前聊天链路耦合。

---

## 4. 三个必须区分的概念

| 概念 | 位置 | 本次实现 |
| --- | --- | --- |
| 传输 Payload | Web → Server | session 模式只有 `conversationId + message`；stateless 模式保留 `messages` |
| 模型上下文 | Server → Model | 由 `context/` 按预算生成，不等于 payload |
| 会话记忆 | 存储层 | 历史消息 + 摘要 + 长期记忆 + 知识库 |

关键认知：

- payload 变小，不等于模型 Token 变小。
- 把历史搬到服务端，如果仍然全量发给模型，成本和上下文压力不会下降。
- 真正决定成本与效果的是 **Context Builder 这一次选择了什么**。

---

## 5. 请求流程

### 5.1 Session 模式（当前 Web 使用）

```text
Web                          Server                         Store                 Model
 │ POST /api/chat            │                               │                     │
 │ {conversationId,message}  │                               │                     │
 │──────────────────────────▶│                               │                     │
 │                           │ 校验 + requestId + 会话锁      │                     │
 │                           │ 读取会话历史 ─────────────────▶│                     │
 │                           │ 召回记忆 / 检索知识库           │                     │
 │                           │ Context Builder 预算与裁剪      │                     │
 │                           │ 追加 user 消息 ───────────────▶│                     │
 │                           │ 调用模型 ──────────────────────────────────────────▶│
 │◀──── SSE delta ───────────│                               │                     │
 │                           │ 追加 assistant 消息 ──────────▶│                     │
 │◀──── SSE done + stats ────│                               │                     │
 │                           │ 后台：摘要 / 长期记忆提取       │                     │
```

要点：

- `conversationId` 省略时自动创建会话，并把新 ID 放入 `X-Conversation-Id` 响应头和 `done`/JSON 响应。
- 同一会话同一时刻只允许一个生成请求，冲突返回 `409`。
- user 消息在调用模型前写入；assistant 消息在响应结束前写入（`done` 之前），避免客户端刚收到 `done` 就读取会话却看不到回复。
- 中断/失败时，已生成的部分内容以 `aborted` / `error` 状态保存；空内容不写入。

### 5.2 Stateless 模式（兼容旧客户端）

```json
{
  "messages": [
    { "role": "user", "content": "解释一下闭包" }
  ],
  "stream": true
}
```

- 最后一条必须是 `user` 消息。
- 服务端不创建会话，但**仍然经过 Context Builder**：会按预算保留最近历史，并注入记忆/知识（如果启用）。
- 这是旧前端的兼容路径，不是长期形态。

### 5.3 流式与非流式

| 维度 | 流式（默认） | 非流式 |
| --- | --- | --- |
| 响应类型 | `text/event-stream` | `application/json` |
| 错误表达 | 头已发出后只能发 `error` 事件 | HTTP 状态码 + JSON |
| 中断 | `aborted` 事件 | 499 JSON |
| 适用 | Web 打字机效果 | curl 调试、脚本调用 |

### 5.4 中断链路

```text
客户端断开                         POST /api/chat/abort { requestId }
   │                                          │
   ▼                                          ▼
res "close" → controller.abort("client-close")   active-requests 查找 → abort("api")
   └──────────────────┬───────────────────────┘
                      ▼
        OpenAI SDK 收到 signal → 取消底层 HTTPS 请求
                      ▼
        路由检查 signal.aborted → 保存部分回复 + 发送 aborted / 返回 499
```

注意：OpenAI SDK 在部分中断场景下会让流迭代**正常结束**而不是抛错，所以路由在 `for await` 结束后还会再检查一次 `signal.aborted`。

---

## 6. 上下文工程（核心）

### 6.1 组装顺序

```text
system prompt（稳定，放最前，利于 Prompt 缓存）
  ├─ 历史摘要（summary-window）
  ├─ 长期记忆
  ├─ 知识库参考资料
  ├─ 最近对话（按完整轮次）
  └─ 当前用户消息（永远保留）
```

### 6.2 预算公式

```text
available = maxContextTokens
          - reserveOutputTokens
          - systemTokens
          - currentTokens
          - safetyMargin（2% 窗口，至少 32）

summary   ≤ min(summaryMaxTokens, 25% × available)
memory    ≤ min(maxContextTokens × memoryBudgetRatio, 35% × 剩余)
knowledge ≤ min(maxContextTokens × knowledgeBudgetRatio, 50% × 剩余)
history   = 剩余预算，从新到旧按完整轮次加入
```

- 安全余量用于吸收估算误差。
- 预算从新到旧分配；一旦某一轮放不下就停止，保证历史连续。
- `system prompt` 与当前用户消息永不裁剪。

### 6.3 三种策略

| 策略 | 摘要 | 历史 | 适用 |
| --- | --- | --- | --- |
| `full` | 否 | 预算内尽量全量，忽略 `CONTEXT_MAX_MESSAGES` | 调试、对比 |
| `window` | 否 | 最近 N 条，受预算约束 | 默认 |
| `summary-window` | 是 | 摘要 + 最近 N 条 | 长对话 |

通过 `CONTEXT_STRATEGY` 切换。摘要只在 `summary-window` 下生成，避免其他模式白跑模型。

`resolveContextPolicy` 的 13 个返回值、合并优先级与逐项影响见 [src/context/context.policy.md](src/context/context.policy.md)。

### 6.4 选择规则

- 只纳入 `status === "done"` 且内容非空的消息。
- `aborted` / `error` 消息默认不进入上下文，但保留在会话记录中（`filteredMessages` 统计）。
- 以 `user` 开启一轮，后续 `assistant` 归入同一轮；开头孤立 assistant 会被忽略。
- 不产生「只有 assistant、没有对应 user」的孤立上下文。
- 超预算时停止，而不是先塞进去再截断。

### 6.5 Token 估算

- 中文/CJK：约 1 字符 = 1 Token（保守高估）。
- 英文/数字：约 4 字符 = 1 Token。
- 每条消息额外 +4 结构开销。
- 估算只用于预算；实际成本以模型返回的 `usage.prompt_tokens` 为准。

实测示例：一次 1 条消息的请求，估算 83，实际 `prompt_tokens = 72`；知识库场景估算 196，实际 140。估算偏保守，符合预期。

### 6.6 上下文统计

每次请求都会在日志、`done` 事件、非流式 JSON 中返回：

```json
{
  "strategy": "window",
  "budgetTokens": 8000,
  "estimatedTokens": 113,
  "systemTokens": 69,
  "summaryTokens": 0,
  "memoryTokens": 0,
  "knowledgeTokens": 0,
  "historyTokens": 27,
  "currentTokens": 17,
  "includedMessages": 2,
  "droppedMessages": 0,
  "filteredMessages": 0,
  "summaryUsed": false,
  "memoryUsed": 0,
  "knowledgeUsed": 0,
  "truncated": false
}
```

这些字段是排查「模型为什么忘了/为什么这么贵」的第一手证据。

---

## 7. 会话管理与摘要

### 7.1 数据模型

```ts
type Conversation = {
  id: string;
  userId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  summaryUpToMessageId?: string;
  summaryUpdatedAt?: string;
  metadata?: Record<string, unknown>;
  messages: ConversationMessage[];
};

type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "done" | "aborted" | "error";
  createdAt: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model?: string;
  metadata?: Record<string, unknown>;
};
```

字段为未来预留：`userId`（用户系统）、`metadata`（标签/场景）、`usage`（成本归因）、`model`（多模型对比）。

### 7.2 存储

当前是内存实现：

- 最多 200 个会话，超出淘汰最久未更新的会话。
- 服务重启即清空。
- `ConversationRepository` 是异步接口，未来换 SQLite/Redis 不需要改上层。
- `appendMessage` 会自动用第一条 user 消息生成标题（最多 30 字）。

> 详细说明（存哪里、每个方法做什么、内存边界、如何换持久化）：[src/conversation/conversation.repository.md](src/conversation/conversation.repository.md)

### 7.3 滚动摘要

触发条件（同时满足）：

1. 策略为 `summary-window`；
2. 所有 `done` 消息估算 Token 超过 `maxContextTokens × summaryThreshold`（默认 60%）；
3. 除最近 `summaryKeepTurns` 轮外，还有至少 2 条尚未摘要的消息。

执行方式：

- 只摘要 `summaryUpToMessageId` 之后、最近 K 轮之前的消息。
- 把「已有摘要 + 新增对话」合并成结构化 JSON：事实、偏好、约束、未完成事项、关键决策。
- 渲染成中文分段文本写入 `conversation.summary`。
- 更新 `summaryUpToMessageId`，避免重复摘要。
- 失败不阻塞对话，下一轮自动重试；同一会话的摘要任务串行化。

摘要是有损的，所以最近 K 轮始终保留原文。

---

## 8. 长期记忆

### 8.1 定位

长期记忆只保存**跨会话仍然有用**的信息：稳定事实、长期偏好、未完成待办。不是聊天记录，也不是知识库。

### 8.2 流程

```text
一轮对话成功
   │
   ▼（后台，不阻塞响应）
小模型提取 JSON：{"memories":[{"kind":"fact|preference|task","content":"..."}]}
   │
   ▼
按 userId + kind + 归一化文本去重，写入内存记忆库
   │
   ▼（下一轮开始）
按当前问题做词重叠 + 更新时间排序，召回 Top N
   │
   ▼
作为 system 消息注入上下文（标注为「仅供参考」）
```

### 8.3 开关与配置

默认关闭：

```bash
MEMORY_ENABLED=false   # 开启后每轮多一次小模型调用
MEMORY_LIMIT=5
MEMORY_BUDGET_RATIO=0.15
```

开启方式：在 `server/.env` 中设置 `MEMORY_ENABLED=true`，重启服务。

### 8.4 限制与安全

- 当前按客户端传入的 `userId` 隔离；**没有鉴权，不能用于多租户生产环境**。
- 提取 Prompt 明确要求不保存密钥、密码、身份证、银行卡等敏感信息，但模型仍可能误提取，生产环境需要脱敏与审核。
- 内存存储，重启清空；最多 200 条/用户。
- 检索是轻量词重叠，不是向量检索；未来可替换为 embedding + 向量库。

---

## 9. 知识库

### 9.1 加载

设置 `KNOWLEDGE_DIR` 后，服务启动时递归加载：

- 支持 `.md` / `.markdown` / `.txt`。
- 最大深度 5，单文件最大 1MB，跳过隐藏目录。
- 标题优先取第一个 `# 标题`，否则用文件名。

留空表示不启用，知识库为空。

### 9.2 分块与检索

- 按空行切段落，超长段落按句子边界切分。
- 默认每块约 800 字符，重叠约 100 字符。
- 索引使用 BM25（`k1=1.5`, `b=0.75`），中文按二元组分词。
- 检索返回 Top K，按分数排序。

### 9.3 引用

命中分块会以编号形式注入上下文：

```text
[1] 《项目默认配置》（来源：config.md）
本项目在本地开发时默认监听端口 4000。
```

同时返回结构化 citation：

```json
{
  "index": 1,
  "id": "config.md#0",
  "source": "config.md",
  "title": "项目默认配置",
  "snippet": "本项目在本地开发时默认监听端口 4000。",
  "score": 3.12
}
```

`citations` 会出现在 `done` 事件和非流式 JSON 中，前端可用于展示来源。

### 9.4 限制

- 内存索引，服务重启重新加载。
- 只有 BM25，没有向量检索、rerank、多跳查询。
- 没有文档权限与租户隔离。
- 检索内容属于不可信输入，Prompt 已标注「仅供参考」；生产环境还需要提示词注入防护。

---

## 10. AI 模块

`ai/chat.ts` 提供两个协议无关的函数：

```ts
completeChat(messages, { model?, temperature?, maxTokens?, signal? })
streamChat(messages, { model?, temperature?, maxTokens?, signal? })
```

- `messages` 是完整的 `LlmMessage[]`，system prompt 由上下文层负责，`ai/` 不拼接任何业务提示词。
- 统一把 SDK 输出映射为 `{ content, finishReason, usage }` 或 `delta/usage` 事件。
- `client.ts` 全进程共享一个 Client，并显式设置超时与重试上限：

```bash
DEEPSEEK_TIMEOUT_MS=120000
DEEPSEEK_MAX_RETRIES=1
```

`stream_options.include_usage: true` 让上游在流末尾返回 usage。

---

## 11. Agent 模块（后续扩展）

当前已提供可编译、可测试的骨架，但**没有接入聊天路由**：

| 文件 | 作用 |
| --- | --- |
| `agent.types.ts` | ToolCall / ToolResult / AgentStep / AgentState / 终止原因 |
| `agent.registry.ts` | 工具注册、JSON Schema 描述、超时执行 |
| `agent.loop.ts` | 最大步数、总超时、中断检查、终止原因与步骤轨迹 |

未来接入路径：

1. 在 `ai/` 中支持 `tools` 参数与流式 `tool_calls` 解析；
2. 用 `ToolRegistry.list()` 生成工具定义；
3. `AgentLoop` 的 executor 调用模型 → 解析工具调用 → `ToolRegistry.execute()` → 追加 observation；
4. 增加最大步数、重复调用检测、人工确认与权限校验。

### 11.1 Web Fetch 工具

`tools/web-fetch/` 提供可独立调用的 `webFetch`，当前尚未接入 AgentLoop：

| 模式 | 行为 |
| --- | --- |
| `http` | `fetch` + 解析原始 HTML，不执行 JS；3xx 直接报错 |
| `browser` | 本机 Chrome `--headless=new --dump-dom`，执行 JS 后解析 |
| `auto` | 先 `http`，正文为空或过短时回退到 `browser` |

- 浏览器模式自动查找 Chrome，可用 `CHROME_PATH` 指定；使用临时 profile，抓完即删。
- 入口 URL 有私网校验，但浏览器会跟随重定向并加载子资源，不适合直接暴露给不可信用户。
- 完整说明见 [src/tools/web-fetch/web-fetch.md](src/tools/web-fetch/web-fetch.md)。

---

## 12. API 参考

### 12.1 `POST /api/chat`

#### Session 模式

```json
{
  "conversationId": "uuid（可选，省略则自动创建）",
  "message": "只回复两个字：收到",
  "stream": true,
  "userId": "demo（可选）"
}
```

#### Stateless 模式（兼容旧前端）

```json
{
  "messages": [
    { "role": "user", "content": "解释闭包" }
  ],
  "stream": true
}
```

规则：

- `message` 与 `messages` 必须且只能提供一个。
- `messages` 最后一条必须是 `user`。
- 单条消息最多 8000 字符；stateless 最多 20 条。
- `stream` 默认 `true`。

#### SSE 事件

```text
data: {"type":"delta","content":"闭包"}

data: {"type":"done","usage":{...},"conversationId":"...","context":{...},"citations":[]}

data: {"type":"aborted","message":"生成已中断"}

data: {"type":"error","message":"模型调用失败，请稍后重试"}
```

#### 非流式响应

```json
{
  "content": "收到",
  "finishReason": "stop",
  "usage": { "prompt_tokens": 72, "completion_tokens": 10, "total_tokens": 82 },
  "conversationId": "uuid",
  "context": { "...": "ContextStats" },
  "citations": []
}
```

#### 响应头

- `X-Request-Id`：请求追踪 ID（优先使用客户端传入值）。
- `X-Conversation-Id`：session 模式实际使用的会话 ID（含自动创建）。

### 12.2 `POST /api/chat/abort`

```json
{ "requestId": "客户端发起聊天时使用的 X-Request-Id" }
```

- `200 { "ok": true, "requestId": "..." }`
- `404 { "error": "未找到进行中的请求", "requestId": "..." }`

### 12.3 会话接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/conversations` | 新建会话，body `{ title?, userId? }`，返回 201 |
| `GET` | `/api/conversations?userId=&limit=` | 会话列表（不含完整消息，limit 1–100，默认 20） |
| `GET` | `/api/conversations/:id` | 读取会话与全部消息（刷新恢复） |
| `PATCH` | `/api/conversations/:id` | 重命名，body `{ title }` |
| `DELETE` | `/api/conversations/:id` | 删除会话 |

会话不存在返回 `404`；同一会话并发生成返回 `409`。

### 12.4 `GET /api/logs`

```http
GET /api/logs?limit=50&requestId=<可选>
```

- `limit` 1–200，默认 50，新的在前。
- 日志保存在进程内存，最多 200 条，重启清空。
- 聊天日志新增：`chat.mode`、`chat.conversationId`、`chat.context`、`response.context`、`response.citations`。

### 12.5 `GET /api/health`

```json
{
  "status": "ok",
  "activeRequests": 0,
  "conversations": 0,
  "knowledgeChunks": 0
}
```

---

## 13. 配置说明

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 无（必填） | 模型服务鉴权，仅存在服务端 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容接口地址 |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 模型名 |
| `DEEPSEEK_TIMEOUT_MS` | `120000` | 单次模型请求超时 |
| `DEEPSEEK_MAX_RETRIES` | `1` | SDK 重试次数上限 |
| `PORT` | `3001` | HTTP 端口 |
| `CORS_ORIGIN` | `http://localhost:5173` | 允许来源，逗号分隔，`*` 表示全部 |
| `CONTEXT_STRATEGY` | `window` | `full` / `window` / `summary-window` |
| `CONTEXT_MAX_TOKENS` | `8000` | 模型上下文预算 |
| `CONTEXT_MAX_MESSAGES` | `20` | 窗口策略的历史条数上限 |
| `CONTEXT_RESERVE_OUTPUT` | `1024` | 输出预留 Token |
| `CONTEXT_SUMMARY_THRESHOLD` | `0.6` | 历史占用达到多少比例触发摘要 |
| `CONTEXT_SUMMARY_KEEP_TURNS` | `4` | 摘要时保留最近多少轮原文 |
| `CONTEXT_SUMMARY_MAX_TOKENS` | `800` | 摘要自身上限 |
| `CONTEXT_SYSTEM_PROMPT` | 空 | 为空使用内置 system prompt |
| `MEMORY_ENABLED` | `false` | 是否启用长期记忆 |
| `MEMORY_LIMIT` | `5` | 每轮召回条数 |
| `MEMORY_BUDGET_RATIO` | `0.15` | 记忆预算占比 |
| `KNOWLEDGE_DIR` | 空 | 知识库目录；为空表示不启用 |
| `KNOWLEDGE_TOP_K` | `4` | 检索分块数 |
| `KNOWLEDGE_BUDGET_RATIO` | `0.25` | 知识预算占比 |

完整示例见 [`.env.example`](.env.example)。

---

## 14. 可观测性

每次聊天请求会记录：

- `requestId`、路径、状态码、耗时、`completed/closed`；
- 请求模式、会话 ID、是否流式；
- 上下文统计（包含/丢弃/过滤条数、各区域 Token、是否使用摘要/记忆/知识）；
- 响应内容预览（控制台截断 2000 字符，存储保留完整内容）；
- usage（prompt/completion/total tokens）；
- citations；
- 中断原因或错误信息。

排查建议：

| 症状 | 先看哪里 |
| --- | --- |
| 模型「忘记」早期内容 | `context.stats` 的 `includedMessages/droppedMessages/summaryUsed` |
| Token 成本偏高 | `context.stats` 各区 Token、`usage.prompt_tokens` |
| 知识库没命中 | `/api/health` 的 `knowledgeChunks`、`context.knowledgeUsed` |
| 记忆没生效 | `MEMORY_ENABLED`、`context.memoryUsed` |
| 同一会话 409 | 是否上一轮仍在生成；`activeRequests` |
| 流式一次性到达 | 代理缓冲、`X-Accel-Buffering`、是否启用压缩 |

---

## 15. 兼容性与迁移

### 15.1 Stateless 客户端无需修改

旧的 `{ messages }` 调用方式仍然可用：

```json
{ "messages": [...], "stream": true }
```

服务端继续支持，并额外返回 `context`/`citations` 字段；不关心这些字段的旧客户端可以忽略。当前 Web 已不使用该模式。

### 15.2 前端接入 Session 模式（已实现）

> Web 已迁移到 session 模式；以下保留作为其他客户端（移动端、CLI、桌面端）的接入参考。

```ts
// 第一轮可以不带 conversationId
const response = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
  body: JSON.stringify({ message: text, stream: true }),
  signal,
});

const conversationId = response.headers.get("X-Conversation-Id");
// 保存到 localStorage；后续请求带上 conversationId

// 刷新恢复
const res = await fetch(`/api/conversations/${conversationId}`);
const { conversation } = await res.json();
```

迁移后：

- 前端 payload 恒定，不再随轮次增长。
- 多端/刷新后历史一致。
- 上下文策略只在服务端维护一份。

### 15.3 行为变化

- stateless 模式现在也会做预算裁剪；极长历史可能被丢弃。
- stateless 模式最后一条必须是 `user`。
- 单条消息上限仍是 8000 字符；stateless 仍最多 20 条，但实际发给模型的条数由预算决定。
- 默认 system prompt 增加了「引用资料标注编号」等约束。
- 响应新增 `context`、`citations`、`conversationId` 字段，均为增量。

---

## 16. 本地验证

```bash
cd server
npm run typecheck

# 启动
PORT=3999 npm start

# 健康检查
curl http://127.0.0.1:3999/api/health

# 创建会话
curl -X POST http://127.0.0.1:3999/api/conversations \
  -H 'Content-Type: application/json' \
  -d '{"title":"测试会话","userId":"demo"}'

# 非流式聊天（stateless 兼容模式）
curl -X POST http://127.0.0.1:3999/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"只回复两个字：收到"}],"stream":false}'

# 流式聊天（session 模式）
curl -N -X POST http://127.0.0.1:3999/api/chat \
  -H 'Content-Type: application/json' \
  -H 'X-Request-Id: demo-1' \
  -d '{"conversationId":"<id>","message":"我叫什么？","stream":true}'

# 查看日志（含 context 统计）
curl 'http://127.0.0.1:3999/api/logs?limit=5'
```

本次重构已实际验证：

- 类型检查通过；
- 会话创建、列表、读取、重命名；
- stateless 非流式聊天；
- session 两轮对话，第二轮回想起第一轮内容；
- SSE `delta` + `done`（含 context 统计）；
- 参数校验 400、未找到中断请求 404；
- 知识库加载、BM25 检索、citation 返回与模型回答。

---

## 17. 已知限制与下一步

| 限制 | 影响 | 下一步 |
| --- | --- | --- |
| 会话/记忆/知识均为内存 | 重启丢失，无法多实例 | Repository 换 SQLite/Redis；知识索引持久化 |
| 无鉴权 | `userId` 可伪造 | 接入登录与鉴权，会话归属校验 |
| 会话锁是进程内 Set | 多实例下失效 | Redis 分布式锁或会话队列 |
| 摘要/记忆有损 | 可能丢失细节 | 结构化摘要 + 评估集 + 最近窗口 |
| 知识库只有 BM25 | 语义召回弱 | embedding + 向量库 + rerank |
| Agent 未接入 | 不能工具调用 | `ai/` 支持 tools → `AgentLoop` → `ToolRegistry` |
| 无幂等 | 同一请求重试可能重复写消息 | 基于 requestId 的消息去重 |
| 无速率限制 | 可能被刷 | 按 IP/用户限流 |
| 前端仍用 stateless | payload 仍随历史增长 | 迁移到 session 模式 |
| 无评估集 | 无法量化上下文策略效果 | 固定问题集回归 + Token 对比 |

---

## 18. 推荐阅读顺序

1. [`src/app.ts`](src/app.ts)：HTTP 管线怎么排
2. [`src/api/chat.ts`](src/api/chat.ts)：两种模式、SSE 生命周期、中断与并发
3. [`src/conversation/chat.service.ts`](src/conversation/chat.service.ts)：一次对话如何准备与收尾
4. [`src/context/context.builder.ts`](src/context/context.builder.ts)：上下文如何组装
5. [`src/context/context.policy.ts`](src/context/context.policy.ts)：策略与默认值
6. [`src/context/context.budget.ts`](src/context/context.budget.ts)：Token 估算与预算
7. [`src/context/context.selector.ts`](src/context/context.selector.ts)：历史/记忆/知识如何选择
8. [`src/conversation/conversation.summary.ts`](src/conversation/conversation.summary.ts)：滚动摘要
9. [`src/memory/memory.service.ts`](src/memory/memory.service.ts)、[`src/knowledge/knowledge.service.ts`](src/knowledge/knowledge.service.ts)：长期记忆与知识库
10. [`src/agent/agent.loop.ts`](src/agent/agent.loop.ts)：未来工具循环

一句话总结：

> **上下文管理的核心不是「把历史搬到哪里」，而是「这一次，在预算内，把哪些信息交给模型」。**
