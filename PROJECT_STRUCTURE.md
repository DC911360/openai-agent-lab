# 项目目录说明

> 项目：openai-agent-lab
> 最后更新：2026-10-29
> 定位：**本项目目录结构的唯一事实来源**。新增、移动、删除文件后，请同步更新本文。
> 架构与请求链路见 [server/ARCHITECTURE.md](server/ARCHITECTURE.md)；启动方式见 [README.md](README.md)。

---

## 1. 顶层结构

```text
openai-agent-lab/
├── README.md                      # 项目入口：能力、启动、命令、文档索引
├── 聊天请求处理地图.md             # 一次聊天请求的完整链路与上下文工程地图
├── PROJECT_STRUCTURE.md           # 本文：目录与逐文件职责
├── CONTEXT_MANAGEMENT_DESIGN.md   # 上下文工程：问题、方案、业界对比
├── CONTEXT_MANAGEMENT_PLAN.md     # 上下文工程：阶段任务与完成状态
├── server/                        # Node.js 后端
└── web/                           # Vue 3 前端
```

| 目录/文件 | 作用 |
| --- | --- |
| `README.md` | 新成员第一次阅读的入口 |
| `聊天请求处理地图.md` | 查“一次聊天请求经过哪些步骤、上下文工程在哪、参数如何到模型” |
| `PROJECT_STRUCTURE.md` | 查“这个文件是干什么的”“新增功能该放哪” |
| `CONTEXT_MANAGEMENT_DESIGN.md` | 理解上下文工程的设计动机与取舍 |
| `CONTEXT_MANAGEMENT_PLAN.md` | 查看已完成/未完成事项 |
| `server/` | HTTP API、会话、上下文、模型调用 |
| `web/` | 聊天界面与 SSE 解析 |

---

## 2. Server 目录

```text
server/
├── ARCHITECTURE.md               # server 架构、上下文算法、API、配置
├── NOTES.md                      # 学习笔记：依赖、dotenv、SDK 响应、SSE
├── .env.example                  # 环境变量模板
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                  # 进程入口
    ├── app.ts                    # Express 装配
    ├── config/
    │   └── env.ts                # 环境变量读取与校验
    ├── lib/
    │   ├── errors.ts             # 带 HTTP 状态码的业务错误
    │   └── text.ts               # 文本归一化、分词、截断
    ├── api/                      # HTTP 层
    │   ├── chat.ts
    │   ├── chat.schema.ts
    │   ├── conversations.ts
    │   ├── conversation.schema.ts
    │   ├── logs.ts
    │   ├── health.ts
    │   ├── sse.ts
    │   ├── validation.ts
    │   ├── active-requests.ts
    │   ├── conversation-locks.ts
    │   ├── request-logger.ts
    │   ├── log-store.ts
    │   ├── log.types.ts
    │   └── logger.ts
    ├── ai/                       # 模型层
    │   ├── client.ts
    │   ├── chat.ts
    │   └── ai.types.ts
    ├── context/                  # 上下文工程核心
    │   ├── context.types.ts
    │   ├── context.policy.ts
    │   ├── context.budget.ts
    │   ├── context.selector.ts
    │   └── context.builder.ts
    ├── conversation/             # 会话与摘要
    │   ├── conversation.types.ts
    │   ├── conversation.repository.ts
    │   ├── conversation.repository.md
    │   ├── conversation.service.ts
    │   ├── conversation.summary.ts
    │   └── chat.service.ts
    ├── memory/                   # 长期记忆
    │   ├── memory.types.ts
    │   ├── memory.store.ts
    │   ├── memory.extractor.ts
    │   └── memory.service.ts
    ├── knowledge/                # 知识库
    │   ├── knowledge.types.ts
    │   ├── knowledge.loader.ts
    │   ├── knowledge.store.ts
    │   ├── knowledge.retriever.ts
    │   └── knowledge.service.ts
    ├── agent/                    # Agent 扩展骨架
    │   ├── agent.types.ts
    │   ├── agent.registry.ts
    │   └── agent.loop.ts
    └── tools/                    # 可复用工具
        └── web-fetch/
            ├── web-fetch.ts
            ├── types.ts
            ├── web-fetch.test.ts
            └── web-fetch.md
```

### 2.1 入口与装配

| 文件 | 职责 | 关键点 |
| --- | --- | --- |
| `src/index.ts` | 初始化知识库、创建 app、监听端口、优雅退出 | 启动失败直接退出；SIGINT/SIGTERM 关闭服务 |
| `src/app.ts` | 中间件顺序、路由挂载、404、错误处理 | `cors → express.json → requestLogger → 路由 → 404 → error` |
| `src/config/env.ts` | dotenv、环境变量读取、范围校验 | Key 缺失或数值非法时 fail-fast |

### 2.2 `api/`：HTTP 路由、校验、SSE

| 文件 | 职责 |
| --- | --- |
| `chat.ts` | 聊天与中断接口的编排：会话锁、SSE、非流式、持久化、日志 |
| `chat.schema.ts` | session / stateless / abort 请求的 zod schema |
| `conversations.ts` | 会话创建、列表、读取、重命名、删除 |
| `conversation.schema.ts` | 会话接口的 zod schema |
| `logs.ts` | `GET /api/logs`，按 requestId 过滤 |
| `health.ts` | `GET /api/health`，返回活跃请求、会话数、知识分块数 |
| `sse.ts` | SSE 响应头、flushHeaders、事件帧格式 |
| `validation.ts` | 统一 400 参数错误响应 |
| `active-requests.ts` | `requestId → AbortController`，支持主动中断 |
| `conversation-locks.ts` | 同一会话并发生成时返回 409 |
| `request-logger.ts` | 生成/透传 requestId，记录请求与响应生命周期 |
| `log-store.ts` | 进程内日志环形缓冲（最多 200 条） |
| `log.types.ts` | 日志结构，含上下文统计与 citations |
| `logger.ts` | 长文本预览、requestId 与日志条目读取、JSON 日志写入 |

### 2.3 `ai/`：模型 SDK 封装

| 文件 | 职责 |
| --- | --- |
| `client.ts` | 全进程共享一个 OpenAI Client；设置超时与重试上限 |
| `chat.ts` | `completeChat` / `streamChat`，统一请求参数与输出映射 |
| `ai.types.ts` | `LlmMessage`、`LlmUsage`、`LlmStreamEvent`、`LlmCompletionResult` |

`ai/` 不拼接业务提示词，也不知道会话、上下文、记忆的存在；system prompt 由 `context/` 提供。

### 2.4 `context/`：上下文工程核心

| 文件 | 职责 | 关键内容 |
| --- | --- | --- |
| `context.types.ts` | 上下文类型定义 | `ContextPolicy`、`ContextStats`、`ContextResult`、记忆/知识/引用类型 |
| `context.policy.ts` | 上下文策略 | 默认 system prompt、`full/window/summary-window`、从 env 解析策略 |
| [context.policy.md](server/src/context/context.policy.md) | `resolveContextPolicy` 速查 | 13 个返回值的含义、合并优先级、对预算/摘要/记忆/知识的影响 |
| `context.budget.ts` | Token 预算与裁剪 | 中文按 1 字符≈1 Token、英文 4 字符≈1 Token、安全余量、按 Token 截断 |
| `context.selector.ts` | 信息选择与排序 | 完整轮次选择、过滤 aborted/error、记忆相关度排序、知识预算裁剪 |
| `context.builder.ts` | 上下文组装 | 预算分配、system/摘要/记忆/知识/历史/当前消息顺序、统计与 citations |

预算分配顺序：

```text
system prompt → 当前消息 → 输出预留 → 安全余量
  → 摘要 → 长期记忆 → 知识库 → 最近历史
```

### 2.5 `conversation/`：会话、消息、摘要

| 文件 | 职责 |
| --- | --- |
| `conversation.types.ts` | `Conversation`、`ConversationMessage`、状态、usage、摘要字段 |
| `conversation.repository.ts` | Repository 接口 + 内存实现；最多 200 个会话；自动标题 |
| [conversation.repository.md](server/src/conversation/conversation.repository.md) | Repository 速查：数据存在哪、8 个方法分别做什么、内存实现的边界 |
| `conversation.service.ts` | 会话 CRUD、追加消息、更新摘要、统计会话数 |
| `conversation.summary.ts` | 摘要阈值判断、收集待摘要消息、调用模型、结构化渲染、并发锁 |
| `chat.service.ts` | `prepareTurn` / `finishTurn` / `afterTurn`，串联会话、上下文、记忆、知识、AI |

`ConversationRepository` 方法是异步的，未来替换 SQLite/Redis 时上层无需改动。

### 2.6 `memory/`：长期记忆

| 文件 | 职责 |
| --- | --- |
| `memory.types.ts` | 记忆类型：`fact` / `preference` / `task` |
| `memory.store.ts` | 内存记忆库；按用户隔离、去重、上限 200 条/用户、词重叠召回 |
| `memory.extractor.ts` | 用小模型从一轮对话提取 JSON 记忆 |
| `memory.service.ts` | 召回相关记忆、后台写入、`userId` 归一化 |

默认关闭。开启方式：`MEMORY_ENABLED=true`。开启后每轮成功对话会多一次小模型调用。

### 2.7 `knowledge/`：知识库

| 文件 | 职责 |
| --- | --- |
| `knowledge.types.ts` | 文档、分块、检索结果 |
| `knowledge.loader.ts` | 递归加载 `.md/.markdown/.txt`，按段落分块并保留重叠 |
| `knowledge.store.ts` | 内存 BM25 索引（中文二元组、英文单词） |
| `knowledge.retriever.ts` | 检索入口 |
| `knowledge.service.ts` | 幂等初始化、检索、分块数统计 |

配置 `KNOWLEDGE_DIR` 后启用；不配置则知识库为空，不会影响聊天。

### 2.8 `agent/`：Agent 扩展骨架

| 文件 | 职责 |
| --- | --- |
| `agent.types.ts` | `AgentStep`、`AgentState`、`AgentRunResult`、终止原因 |
| `agent.registry.ts` | 工具注册、JSON Schema 描述、超时执行 |
| `agent.loop.ts` | 最大步数、总超时、中断检查、终止原因与步骤轨迹 |

当前没有被 `api/` 引用，属于后续扩展点。

### 2.9 `tools/`：可复用工具

| 文件 | 职责 |
| --- | --- |
| `web-fetch/web-fetch.ts` | `webFetch`：HTTP 抓取、Chrome 渲染、auto 回退 |
| `web-fetch/types.ts` | `WebFetchInput`、`WebFetchRenderMode`、`WebFetchResult` |
| `web-fetch/web-fetch.test.ts` | 可直接用 tsx 运行的示例脚本 |
| [web-fetch/web-fetch.md](server/src/tools/web-fetch/web-fetch.md) | 三种模式、Chrome 配置、安全边界 |

`render` 支持 `http`（默认）、`browser`、`auto`：

```text
http    → fetch + 解析原始 HTML，不执行 JS
browser → 本机 Chrome --headless=new --dump-dom，执行 JS 后解析
auto    → 先 http，正文为空/过短时回退 browser
```

浏览器模式需要本机安装 Chrome；可用 `CHROME_PATH` 指定路径，容器内可用 `CHROME_NO_SANDBOX=1`。当前没有被 `api/` 或 agent 循环调用。

---

## 3. Web 目录

```text
web/
├── README.md                 # 前端说明：启动、session 模式、SSE 解析
├── index.html
├── package.json
├── vite.config.ts            # 端口 5173，/api 代理到 3001
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
└── src/
    ├── main.ts               # 创建 Vue 应用
    ├── App.vue               # 挂载 ChatPanel
    ├── api/
    │   └── chat.ts           # 发送聊天请求、调用 abort
    ├── composables/
    │   └── useChatStream.ts  # 消息状态、SSE 解析、发送/停止
    ├── components/
    │   ├── ChatPanel.vue     # 页面容器、消息列表、输入区、自动滚动
    │   ├── MessageItem.vue   # 单条消息、状态、Markdown
    │   └── MarkdownContent.vue # marked + DOMPurify
    ├── types/
    │   └── chat.ts           # 前端消息与 SSE 事件类型
    └── assets/
        └── styles.css
```

| 文件 | 职责 |
| --- | --- |
| `src/api/chat.ts` | `sendChatStream`、`abortChat`，统一错误信息解析 |
| `src/composables/useChatStream.ts` | 维护消息列表与流式状态；按 `\n\n` 切分 SSE；处理跨 chunk 缓冲 |
| `src/components/ChatPanel.vue` | 聊天布局、输入框、发送/停止、自动滚动 |
| `src/components/MessageItem.vue` | 用户/助手气泡、流式光标、错误/中断状态 |
| `src/components/MarkdownContent.vue` | Markdown 渲染与 XSS 消毒 |
| `src/types/chat.ts` | 与后端 SSE 协议保持一致的类型 |

当前前端使用 **session 模式**：每轮只发送当前消息，`conversationId` 保存在 `localStorage`；启动时加载会话列表与当前会话，支持新建、切换、重命名、删除和刷新恢复。Stateless 模式仅作为服务端兼容入口保留。

---

## 4. 数据流与文件对应关系

### 4.1 Session 模式

```text
POST /api/chat { conversationId, message }
  │
  ▼
api/chat.ts
  ├─ api/active-requests.ts        登记 requestId
  ├─ api/conversation-locks.ts     会话锁
  ▼
conversation/chat.service.ts  prepareTurn
  ├─ conversation/conversation.service.ts  读取/创建会话
  ├─ memory/memory.service.ts              召回长期记忆
  ├─ knowledge/knowledge.service.ts        检索知识库
  └─ context/context.builder.ts            组装本次上下文
  ▼
ai/chat.ts  streamChat / completeChat
  ▼
conversation/chat.service.ts  finishTurn   持久化 assistant
  ▼
SSE delta / done（带 context 与 citations）
  ▼
conversation/conversation.summary.ts       后台摘要（summary-window）
memory/memory.service.ts                   后台记忆提取（启用时）
```

### 4.2 Stateless 模式（兼容旧客户端）

```text
POST /api/chat { messages }
  │
  ▼
api/chat.ts → conversation/chat.service.ts  prepareTurn(stateless)
  ├─ memory / knowledge（可选）
  └─ context/context.builder.ts
  ▼
ai/chat.ts → SSE 或 JSON
```

不写会话、不生成摘要，但仍然经过 Token 预算裁剪。当前 Web 已不使用，保留用于旧客户端、调试与策略对比。

---

## 5. 改动地图：想改什么，去哪里

| 想做的事 | 修改位置 | 备注 |
| --- | --- | --- |
| 新增一个 HTTP 接口 | `server/src/api/` 新建路由 + `server/src/app.ts` 挂载 | 请求 schema 放同模块 |
| 换模型供应商 | `server/src/ai/client.ts`、`ai/chat.ts`、`config/env.ts` | 路由与会话层不变 |
| 改 system prompt | `server/src/context/context.policy.ts` 或 `CONTEXT_SYSTEM_PROMPT` | 保持稳定前缀有利于缓存 |
| 改上下文预算/策略 | `context/context.policy.ts`、`context.budget.ts`、`context.selector.ts` | 策略枚举在 `context.types.ts` |
| 改历史选择规则 | `context/context.selector.ts` | 保持 user/assistant 轮次完整 |
| 改摘要触发/格式 | `conversation/conversation.summary.ts` | 阈值配置在 `config/env.ts` |
| 会话从内存换 SQLite | 新增 `conversation.repository.ts` 的实现 | 接口是异步的，服务层无需改 |
| 长期记忆换数据库/向量 | `memory/memory.store.ts` | `memory.service.ts` 负责编排 |
| 知识库换向量检索 | `knowledge/knowledge.store.ts`、`knowledge.retriever.ts` | 分块逻辑在 loader |
| 接入 Agent 工具调用 | `agent/agent.loop.ts`、`agent.registry.ts`、`ai/chat.ts` | 需要 AI 层支持 `tools` / `tool_calls` |
| 调整 webFetch 抓取方式 | `tools/web-fetch/web-fetch.ts` | `http` / `browser` / `auto`，详见模块内 md |
| 加鉴权/限流 | `server/src/app.ts` 路由之前加中间件 | 同时校验会话归属 |
| 调整前端会话 UI / 请求逻辑 | `web/src/api/chat.ts`、`composables/useChatStream.ts`、`ChatPanel.vue` | 当前已使用 session 模式与 `localStorage` 恢复 |
| 前端展示上下文统计 | `web/src/types/chat.ts` + `MessageItem.vue` | `done` 事件已带 `context` |
| 增加测试 | 在对应模块旁新增 `*.test.ts` | 优先测 `context/` 纯函数 |

---

## 6. 命名与编码约定

- 服务端 ESM + NodeNext：相对导入必须带 `.js` 后缀（源码是 `.ts`）。
- 业务错误使用 `lib/errors.ts` 中的 `AppError` 子类，由 `app.ts` 统一映射为 HTTP 响应。
- 请求校验统一使用 zod schema，放在 `api/*.schema.ts`。
- 纯计算逻辑放 `context/` 与 `lib/`，不要直接调用模型或存储。
- Repository 接口保持异步，便于未来替换持久化实现。
- 所有对外可见的中文文案写在 API/提示词模块中，避免散落在路由里。
- 日志前缀约定：`[req]`、`[res]`、`[chat]`、`[context]`、`[summary]`、`[memory]`、`[knowledge]`、`[conversation]`。

---

## 7. 文档维护规则

| 变更 | 必须更新 |
| --- | --- |
| 新增/移动/删除 `server/src` 文件 | 本文第 2 节 + `server/ARCHITECTURE.md` 对应章节 |
| 改变请求链路、SSE 事件、API 契约 | `server/ARCHITECTURE.md` + 本文第 4 节 |
| 改变模块职责或依赖方向 | 本文 + `server/ARCHITECTURE.md` 第 3 节 |
| 改变上下文策略/预算算法 | `server/ARCHITECTURE.md` 第 6 节 + `CONTEXT_MANAGEMENT_DESIGN.md` |
| 完成/新增阶段任务 | `CONTEXT_MANAGEMENT_PLAN.md` |
| 改变启动方式/环境变量 | `README.md` + `server/.env.example` + `server/ARCHITECTURE.md` 第 13 节 |
| 新增学习笔记 | `server/NOTES.md` |

文档定位：

- `README.md`：入口与快速开始。
- `PROJECT_STRUCTURE.md`：目录与文件职责（本文）。
- `server/ARCHITECTURE.md`：server 内部实现与算法。
- `CONTEXT_MANAGEMENT_DESIGN.md`：设计动机与方案对比，不追踪具体文件路径。
- `CONTEXT_MANAGEMENT_PLAN.md`：任务状态与路线图。
- `server/NOTES.md`：个人学习笔记，不是规范来源。

---

## 8. 当前状态与限制

| 项 | 状态 |
| --- | --- |
| 服务端会话 + 上下文预算 | 已完成 |
| 滚动摘要 | 已完成（`summary-window`） |
| 长期记忆 | 骨架完成，默认关闭 |
| 知识库 BM25 + 引用 | 骨架完成，需配置目录 |
| Agent 工具循环 | 骨架完成，未接入 |
| Web Fetch 浏览器渲染 | 已完成（`http` / `browser` / `auto`，需本机 Chrome） |
| 会话/记忆/知识持久化 | 未完成，当前为内存 |
| 用户系统与鉴权 | 未完成 |
| 前端 session 模式 | 已完成（会话列表、刷新恢复、CRUD） |
| 自动化测试与评估集 | 未完成 |

更详细的限制与下一步见 [server/ARCHITECTURE.md](server/ARCHITECTURE.md#17-已知限制与下一步)。
