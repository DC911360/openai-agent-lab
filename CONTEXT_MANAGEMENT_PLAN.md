# 上下文与会话管理开发计划

> 项目：openai-agent-lab
> 状态：服务端 Phase 2–4 与前端 session 迁移已完成；Phase 0/1/5 的持久化部分未完成
> 制定日期：2026-10-21
> 实施说明：[server/ARCHITECTURE.md](server/ARCHITECTURE.md)
> 实际目录：[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)
> 面向：项目开发者（Agent 学习路线）

## 1. 先厘清三个概念

| 概念 | 位置 | 说明 |
| --- | --- | --- |
| 传输 Payload | 前端 → server | 本次 HTTP 请求携带的 JSON |
| 模型上下文 | server → 模型 | 真正计入 Token 的 messages |
| 会话记忆 | 存储层 | 历史消息、摘要、用户偏好等 |

关键认知：

- **只把 payload 改成当前一条，模型不会自动保留记忆**；记忆必须有地方存。
- **把历史搬到服务端，只是减小了前端 payload**；如果服务端仍把全部历史塞给模型，Token 成本和延迟不会下降。
- 真正控制成本与上下文窗口的是**上下文选择策略**：滑动窗口、摘要、检索、预算分配。
- 因此本计划分两条线：
  - **会话管理**：历史存在哪里、如何新建/切换/删除。
  - **上下文管理**：这一次调用给模型看什么。

## 2. 重构前的问题（已解决）

重构前：

- 前端 [useChatStream.ts](web/src/composables/useChatStream.ts) 的 `buildApiMessages()` 会把最近 20 条消息整体发送。
- 服务端 `server/src/routes/chat.ts` 不保存会话状态，只在消息前追加 system prompt；重构后对应 [server/src/api/chat.ts](server/src/api/chat.ts)。
- 每次请求 payload ≈ Σ(历史消息内容)，随轮次线性增长。

当时带来的问题：

- 请求体变大，网络与序列化开销增加。
- 模型 `prompt_tokens` 线性增长，成本与延迟上升。
- 长对话最终会撞上模型上下文窗口。
- 历史中的失败/中断内容可能污染后续回答。

> 当前状态：前端已迁移到 session 模式（每轮只发当前消息），服务端已实现上下文预算、窗口与摘要策略。

目标形态：

1. 前端 payload 只包含当前用户消息。
2. 多轮记忆由服务端会话承担。
3. 服务端按 Token 预算选择上下文（窗口 → 摘要）。
4. 支持新建、切换、删除会话。

## 3. 方案对比

| 方案 | 前端 payload | 模型看到的内容 | 多轮记忆 | 复杂度 |
| --- | --- | --- | --- | --- |
| A. 单条直传 | 当前 1 条 | 当前 1 条 | 无 | 最低 |
| B. 全量历史（现状） | 全部历史 | 全部历史 | 有 | 低 |
| C. 服务端会话 + 滑动窗口 | 当前 1 条 | system + 最近 N 条 | 有（近期） | 中 |
| D. 服务端会话 + 摘要 + 窗口 | 当前 1 条 | system + 摘要 + 最近 N 条 | 有（长期要点） | 较高 |
| E. 客户端摘要 | 当前 1 条 + 摘要 | 摘要 + 当前 | 部分 | 中 |

推荐路线：

- **立即**：A（单条直传），先满足「payload 只传当前问题」。
- **目标**：C → D（服务端会话 + 窗口 + 摘要）。
- **不建议长期停留**：B（现状）和 E（客户端维护摘要，状态容易不一致）。

> A 的代价：模型没有记忆。追问「再详细一点」「我叫什么」会失效。这是有意的取舍，用来验证 payload 行为。

**实际实施**：没有经过 A，直接落地了 C → D。当前服务端同时支持 session（C/D）与 stateless（B 的兼容入口）；Web 前端已迁移到 session 模式。

## 4. 目标架构

```text
┌─────────┐   conversationId + 当前 message   ┌──────────┐
│   Web   │ ────────────────────────────────▶ │  Server  │
└─────────┘                                   └────┬─────┘
                                                   │
                                     ┌─────────────┼──────────────┐
                                     ▼             ▼              ▼
                              Conversation     Context        LLM API
                                  Store        Builder
                                     │             │
                                     └──── 历史 ────┘
```

职责划分：

| 模块 | 职责 |
| --- | --- |
| Conversation Store | 保存会话消息、摘要、时间戳；后续持久化 |
| Context Builder | 按 Token 预算选出本次要发给模型的消息 |
| Chat Route | 校验、加锁、调用模型、写回会话 |
| Web | 只持有 `conversationId` 与当前输入，不再维护完整上下文 |

## 5. 数据模型与接口

### 5.1 数据模型

```ts
type Conversation = {
  id: string;
  userId?: string;                 // 预留：用户系统
  title: string;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  summaryUpToMessageId?: string;   // 摘要覆盖到的最后一条消息
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
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model?: string;
  metadata?: Record<string, unknown>;
};
```

### 5.2 接口设计

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/api/conversations` | 新建会话，返回完整会话 |
| GET | `/api/conversations?userId=&limit=` | 会话列表（不含完整消息） |
| GET | `/api/conversations/:id` | 读取会话与消息（刷新恢复） |
| PATCH | `/api/conversations/:id` | 重命名会话 |
| DELETE | `/api/conversations/:id` | 删除会话 |
| POST | `/api/chat` | session 或 stateless 聊天 |
| POST | `/api/chat/abort` | 按 requestId 中断生成 |
| GET | `/api/logs` | 日志查询，含上下文统计 |
| GET | `/api/health` | 健康检查与运行状态 |

会话模式请求（`conversationId` 可省略，服务端自动创建）：

```json
{
  "conversationId": "uuid（可选）",
  "message": "只回复两个字：收到",
  "stream": true,
  "userId": "demo（可选）"
}
```

兼容策略：保留 `{ "messages": [...] }` 作为 stateless 模式。两种模式必须且只能提供一个字段；服务端不写会话，但仍会做上下文预算裁剪。

SSE 的 `done` 事件已包含会话 ID、完整上下文统计与引用：

```json
{
  "type": "done",
  "usage": { "prompt_tokens": 1200, "completion_tokens": 80, "total_tokens": 1280 },
  "conversationId": "uuid",
  "context": {
    "strategy": "window",
    "budgetTokens": 8000,
    "estimatedTokens": 1150,
    "includedMessages": 8,
    "droppedMessages": 12,
    "summaryUsed": false,
    "memoryUsed": 0,
    "knowledgeUsed": 0,
    "truncated": true
  },
  "citations": []
}
```

`context` 与 `citations` 是增量字段，旧前端可以忽略。session 模式的响应头还会返回 `X-Conversation-Id`。

## 6. 分阶段开发计划

### Phase 0 — 基线与度量（约 0.5 小时）

- [x] 日志记录消息条数、上下文统计、`prompt_tokens` / `completion_tokens`
- [ ] JSON 字节数单独统计
- [ ] 用 3 / 10 / 20 轮对话记录现状数据
- [ ] 固定一组测试问题，作为后续对比基线

验收：能拿出「轮次 vs payload 大小 vs prompt_tokens」的对比表。

---

### Phase 1 — 单条直传（未采用）

> 未按此方案实施，直接进入 Phase 2；其中「payload 只包含当前消息」已由 session 模式实现。

- [ ] `useChatStream` 的 `buildApiMessages()` 改为只返回当前 user 消息
- [ ] 保留 `VITE_CONTEXT_MODE=single|full` 开关，便于对比
- [ ] UI 上标明「当前为单轮模式」

验收：

- 日志/抓包显示请求中的 `messages` 只有 1 条。
- 连续问「我叫小明」→「我叫什么」，模型回答不知道（预期）。

---

### Phase 2 — 服务端会话（内存版，约 2–3 小时）

- [x] 新增会话模块：`conversation/` 内存 Repository + Service
- [x] `POST/GET/PATCH/DELETE /api/conversations`、`GET /api/conversations/:id`
- [x] `POST /api/chat` 支持 `{ conversationId, message }`；省略 ID 自动创建
- [x] 请求结束后写入 assistant 消息；abort/error 记录状态
- [x] 同一会话的并发请求返回 409
- [x] 前端增加「新会话」、会话列表、切换/重命名/删除，`localStorage` 保存 `conversationId`

验收：

- 多轮对话有记忆，但前端 payload 始终只有当前消息。
- 刷新页面能恢复会话；新建会话后上下文清空。

---

### Phase 3 — 上下文窗口与 Token 预算（约 2–3 小时）

- [x] 新增 `context/context.builder.ts`：从新到旧挑选消息，保持 user/assistant 配对
- [x] 估算 Token：中文按保守系数，英文按 `chars / 4`
- [x] 配置项：`CONTEXT_MAX_TOKENS`、`CONTEXT_MAX_MESSAGES`、`CONTEXT_RESERVE_OUTPUT`
- [x] 默认排除 `error` / `aborted` 消息
- [x] 日志输出 included / dropped / estimatedTokens

验收：

- 构造 20 轮对话，发给模型的上下文不超过预算。
- 最近几轮完整保留；旧消息被丢弃时不会出现「只有 assistant、没有对应 user」的孤立消息。

---

### Phase 4 — 摘要记忆（约 3–4 小时）

- [x] 历史超过阈值时，把较旧消息压缩成摘要（仅 `summary-window`）
- [x] 新摘要与旧摘要合并，保留事实、用户偏好、未完成事项
- [x] 摘要拼进 system 消息，放在系统提示之后
- [x] 记录摘要触发、覆盖消息数与摘要 Token；“节省的 Token”尚未单独统计

验收：

- 长对话后仍能回答早期的关键事实。
- 摘要不会无限增长，整体 Token 用量趋于稳定。

---

### Phase 5 — 持久化与会话管理 UI（约 4–6 小时）

- [ ] 存储从内存迁移到 SQLite（或先用 JSON 文件）
- [x] 会话列表 UI：新建、切换、重命名、删除
- [x] 刷新后恢复会话（服务端内存存活时）
- [x] 数据模型预留 `userId`、`metadata`、`usage`、`summary` 字段

验收：

- 服务重启后会话仍在。
- 删除会话后无法再访问其消息。

---

### Phase 6 — 未来 Agent 能力（暂不实施）

见第 8 节。

## 7. 上下文管理策略清单

| 策略 | 解决什么 | 何时使用 | 代价 |
| --- | --- | --- | --- |
| 滑动窗口 | 控制最近上下文长度 | 默认策略 | 丢失远期细节 |
| Token 预算 | 精确控制输入规模 | 有明确窗口/成本目标 | 需要估算或 tokenizer |
| 配对完整性 | 避免孤儿 assistant 消息 | 截断历史时始终启用 | 实现细节较多 |
| 滚动摘要 | 保留远期要点 | 长对话、成本敏感 | 额外 LLM 调用；可能丢细节 |
| 用户画像 | 跨会话保留偏好 | 用户系统上线后 | 需要治理与去重 |
| RAG 检索 | 按需召回相关知识 | 知识库/历史很多 | 检索质量与延迟 |
| Prompt 缓存 | 复用稳定前缀，降低成本 | system prompt 较长时 | 需保持前缀稳定 |
| 工具结果裁剪 | 控制 ReAct 中间内容 | 接入 tools 后 | 可能丢排查信息 |
| 子 Agent 隔离 | 避免上下文互相污染 | 多任务/多工具 | 架构复杂度 |

### 7.1 截断规则

- 永远保留 system prompt 与当前 user 消息。
- 历史按「从新到旧」加入，以 user/assistant 对为单位。
- 不把 assistant 消息放在历史开头。
- 估算超预算时立即停止加入，而不是先加入再截断。
- `error` / `aborted` 消息默认不参与上下文。

### 7.2 Token 估算

- 中文保守估计：约 1 字符 ≈ 1 Token（先高估，避免超限）。
- 英文：约 4 字符 ≈ 1 Token。
- 用模型返回的 `usage.prompt_tokens` 校准估算系数。
- 预算公式：

```text
可用历史预算 = 上下文窗口 - system prompt - 当前消息 - 预留输出 - 安全余量
```

### 7.3 摘要触发

- 推荐按 Token 触发：历史占用超过上下文预算的 60% 时摘要。
- 保留最近 K 轮原文，只摘要更早的部分。
- 摘要 Prompt 要求保留：事实、用户偏好、约束、未完成任务。
- 摘要也要设上限，避免自身膨胀。

## 8. 未来 Agent 规划（部分骨架已实现）

> 已落地骨架：`memory/` 的提取、存储与召回；`knowledge/` 的加载、BM25 检索与引用；`agent/` 的类型、工具注册与循环。
> 尚未落地：持久化、鉴权、向量检索、模型工具调用接入、ReAct 执行与权限控制。

### 8.1 用户系统与用户提示词

- 用户表、会话归属 `userId`、数据隔离。
- 用户偏好：回答语言、格式偏好、代码风格、禁用的表达方式等。
- 注入优先级建议：

```text
平台安全规则 > System Prompt > 用户偏好 > 历史对话 > 检索内容
```

- 用户偏好应当作「结构化配置」存储，而不是把用户原文直接拼进 system prompt，降低提示词注入风险。

### 8.2 System Prompt 管理

- 模板化、版本化、可回滚。
- 按场景选择模板（问答、代码、Agent 任务）。
- 稳定前缀有利于 Prompt 缓存，降低重复上下文成本。

### 8.3 Tools / Skills

- Tool Registry：名称、描述、JSON Schema、权限、超时。
- 按任务动态选择工具，避免把所有工具定义都塞进上下文。
- Skills = 说明 + 工具 + 示例，按需加载，不活跃的 skill 不进入上下文。
- 高风险工具需要人工确认或权限校验。

### 8.4 ReAct 循环

- 流程：思考 → 行动（工具调用）→ 观察 → 继续或结束。
- 控制：最大步数、总超时、重复调用检测、停止条件。
- 上下文：保留目标、最近 K 步、关键观察摘要；旧的原始工具输出及时裁剪。
- 不必把完整思维链持久化；保存结构化 trace 用于调试与评估。

### 8.5 记忆分层

| 类型 | 内容 | 生命周期 |
| --- | --- | --- |
| 短期记忆 | 当前会话消息 | 会话级 |
| 长期记忆 | 用户偏好、稳定事实 | 跨会话 |
| 情景记忆 | 过去会话摘要 | 长期 |
| 语义记忆 | 文档/知识库，RAG | 长期 |

需要制定写入、去重、过期与隐私策略。

### 8.6 评估、可观测性与安全

- Trace：每次请求的上下文组成、Token 分解、工具调用、耗时。
- 评估集：固定问题集，回归测试上下文策略是否丢失关键信息。
- 安全：提示词注入、工具越权、限流、PII 脱敏。

### 8.7 上下文预算分配（未来参考）

| 区域 | 建议占比 |
| --- | --- |
| System Prompt + 用户偏好 | 10–15% |
| Tool / Skill 定义 | 10–15% |
| 检索到的记忆/文档 | 20–30% |
| 最近对话 | 30–40% |
| 当前输入 + 输出预留 | 剩余 |

## 9. 学习实验

| 实验 | 步骤 | 预期观察 |
| --- | --- | --- |
| 单轮失忆 | 单条模式问「我叫小明」→「我叫什么」 | 模型不知道，理解 payload 与记忆的区别 |
| 全量历史增长 | 连续 10 轮，记录 payload 与 prompt_tokens | 两者近似线性增长 |
| 窗口截断 | 设置最多 4 条历史，再问早期事实 | 近期能答，早期丢失 |
| 摘要记忆 | 超阈值后触发摘要，再问早期关键事实 | 要点保留，细节可能丢失 |
| 用户偏好 | 说「以后都用表格回答」后继续对话 | 偏好是否被窗口/摘要保留 |
| 成本对比 | 对比单轮 / 窗口 / 摘要三种模式的 usage | 理解成本与体验的权衡 |

建议记录指标：

- payload 字节数
- 发送给模型的消息条数
- `prompt_tokens` / `completion_tokens`
- 首 Token 延迟与总耗时
- 上下文丢弃条数

## 10. 当前实现决策

| 决策点 | 当前实现 |
| --- | --- |
| 默认上下文策略 | `window`；保留 `full` 与 `summary-window` 可切换 |
| 会话存储 | 内存 Repository，最多 200 个会话；接口为未来 SQLite/Redis 预留 |
| 旧版 `{ messages }` 接口 | 保留兼容，标记为 stateless 模式 |
| 会话 ID 生成 | 服务端生成；通过 `X-Conversation-Id` 返回，前端存入 `localStorage` 并在刷新时恢复 |
| 中断/失败消息 | 非空部分保存为 `aborted` / `error`，但默认排除出上下文 |
| 摘要触发 | 历史超过预算 60%，且仅 `summary-window` 策略 |
| 并发策略 | 同一会话直接返回 409 |
| 长期记忆 | 默认关闭，`MEMORY_ENABLED=true` 开启 |
| 知识库 | 配置 `KNOWLEDGE_DIR` 后启用，BM25 + 引用 |

## 11. 执行顺序与工作量

```text
Phase 0（度量）             部分完成
   ↓
Phase 1（单条直传）         未实施（被 Phase 2 的 session 模式取代）
   ↓
Phase 2（服务端会话）       ✅ 服务端 + 前端完成
   ↓
Phase 3（窗口与 Token 预算） ✅ 完成
   ↓
Phase 4（摘要记忆）         ✅ 完成（summary-window）
   ↓
Phase 5（持久化 + UI）      未实施
   ↓
未来：用户系统 / Prompt 管理 / Tools / Skills / ReAct
     记忆与知识库骨架已落地，Agent 执行链路未接入
```

当前剩余的主要工作：SQLite/Redis 持久化、鉴权、向量知识库、Agent 工具循环、评估集。

每一步都可以独立上线与回滚；Phase 1 未实施，前端直接使用 session 模式，stateless 仅保留兼容。
