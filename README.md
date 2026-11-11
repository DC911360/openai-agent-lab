# openai-agent-lab

一个用于学习 **Agent 上下文工程** 的全栈实验项目：

- **server**：Express 5 + TypeScript，负责会话管理、上下文预算、滚动摘要、长期记忆、知识库检索与模型调用。
- **web**：Vue 3 + TypeScript + Vite，提供流式聊天界面。

项目重点不是“把历史全部塞给模型”，而是回答一个问题：

> 这一次请求，在 Token 预算内，应该把哪些信息交给模型？

---

## 1. 当前能力

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| SSE 流式聊天 | ✅ | `POST /api/chat`，支持 `delta` / `done` / `aborted` / `error` |
| 中断生成 | ✅ | `POST /api/chat/abort`，同时支持流式与非流式 |
| Session 会话模式 | ✅ | `{ conversationId, message }`，服务端维护历史；Web 已迁移 |
| Stateless 兼容模式 | ✅ | 旧客户端 `{ messages }` 仍可用，Web 不再使用 |
| 上下文 Token 预算 | ✅ | 按 system / 摘要 / 记忆 / 知识 / 历史分配预算 |
| 三种上下文策略 | ✅ | `full` / `window` / `summary-window` |
| 滚动摘要 | ✅ | 仅 `summary-window` 触发，结构化合并旧摘要 |
| 长期记忆 | ✅ 骨架 | 默认关闭；`MEMORY_ENABLED=true` 开启 |
| 知识库检索 | ✅ 骨架 | BM25 + 引用来源；配置 `KNOWLEDGE_DIR` 启用 |
| Agent 工具循环 | 🧩 骨架 | 类型、工具注册表、循环已就绪，尚未接入聊天链路 |
| 会话持久化 | ❌ | 当前为内存实现，重启清空 |
| 用户系统与鉴权 | ❌ | `userId` 由客户端传入，不能作为生产隔离依据 |
| 前端 Session 迁移 | ✅ | 会话列表、刷新恢复、新建/切换/重命名/删除 |

---

## 2. 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3 `<script setup>`、TypeScript、Vite、marked、DOMPurify |
| 后端 | Node.js、Express 5、TypeScript、tsx |
| 校验 | zod |
| 模型 | OpenAI SDK（兼容 DeepSeek Chat Completions） |
| 流式协议 | SSE（`text/event-stream`） |
| 存储 | 进程内存（Repository 接口已为 SQLite/Redis 预留） |

---

## 3. 快速开始

要求：Node.js 20+。

### 3.1 启动 server

```bash
cd server
cp .env.example .env
# 编辑 .env，至少填入 DEEPSEEK_API_KEY
npm install
npm run dev
```

默认地址：`http://localhost:3001`

```bash
curl http://localhost:3001/api/health
```

### 3.2 启动 web

```bash
cd web
npm install
npm run dev
```

打开 `http://localhost:5173`。Vite 已把 `/api` 代理到 `http://127.0.0.1:3001`。

### 3.3 环境变量

完整列表见 [`server/.env.example`](server/.env.example) 与 [server/ARCHITECTURE.md](server/ARCHITECTURE.md#13-配置说明)。

最常用的几个：

```bash
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-flash
CONTEXT_STRATEGY=window          # full | window | summary-window
CONTEXT_MAX_TOKENS=8000
MEMORY_ENABLED=false
KNOWLEDGE_DIR=
```

---

## 4. 目录速览

```text
openai-agent-lab/
├── README.md                     # 项目入口（本文）
├── PROJECT_STRUCTURE.md          # 最新项目目录文档
├── CONTEXT_MANAGEMENT_DESIGN.md  # 上下文管理：为什么这样设计
├── CONTEXT_MANAGEMENT_PLAN.md    # 上下文管理：阶段与完成状态
├── server/
│   ├── ARCHITECTURE.md           # server 架构与请求链路
│   ├── NOTES.md                  # 学习笔记（dotenv / SDK / SSE）
│   ├── .env.example
│   └── src/
│       ├── api/                  # 路由、校验、SSE、日志
│       ├── ai/                   # 模型 SDK 封装
│       ├── context/              # 上下文工程核心
│       ├── conversation/         # 会话、持久化、摘要
│       ├── memory/               # 长期记忆
│       ├── knowledge/            # 知识库与引用
│       ├── agent/                # Agent 扩展骨架
│       ├── config/               # 环境变量
│       ├── lib/                  # 通用工具
│       ├── app.ts
│       └── index.ts
└── web/
    ├── README.md                 # 前端说明
    ├── vite.config.ts            # /api 代理
    └── src/
        ├── api/                  # 请求封装
        ├── components/           # 聊天界面
        ├── composables/          # SSE 解析与状态
        ├── types/
        └── assets/
```

完整的逐文件说明见 [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)。

---

## 5. 文档索引

| 文档 | 回答什么问题 | 状态 |
| --- | --- | --- |
| [README.md](README.md) | 项目是什么、怎么启动 | 最新 |
| [聊天请求处理地图.md](聊天请求处理地图.md) | 一次聊天从 Web 到模型再回到 Web 的完整链路、上下文工程与参数顺序 | 最新 |
| [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) | 每个目录/文件负责什么、改动去哪里 | 最新 |
| [server/ARCHITECTURE.md](server/ARCHITECTURE.md) | server 内部如何运转、上下文算法、API 细节 | 最新 |
| [CONTEXT_MANAGEMENT_DESIGN.md](CONTEXT_MANAGEMENT_DESIGN.md) | 为什么需要上下文工程、方案对比、业界实践 | 长期参考 |
| [CONTEXT_MANAGEMENT_PLAN.md](CONTEXT_MANAGEMENT_PLAN.md) | 哪些阶段已完成、还剩什么 | 持续更新 |
| [server/NOTES.md](server/NOTES.md) | dotenv、OpenAI SDK、SSE 的基础笔记 | 学习笔记 |
| [web/README.md](web/README.md) | 前端如何启动、如何迁移到 session 模式 | 最新 |

---

## 6. 一次请求发生了什么

### Session（当前 Web 使用）

```text
Web
  │ POST /api/chat { conversationId?, message }
  ▼
会话锁 → 读取历史 → 记忆/知识 → Context Builder
  ▼
调用模型 → 持久化 assistant → SSE done
  ▼
后台：滚动摘要 / 长期记忆提取
```

### Stateless（兼容旧客户端）

```text
Web / curl
  │ POST /api/chat { messages }
  ▼
api/chat.ts
  ▼
conversation/chat.service.ts  prepareTurn(stateless)
  ├─ 召回记忆（可选）
  ├─ 检索知识库（可选）
  └─ context/context.builder.ts  按预算裁剪历史
  ▼
ai/chat.ts  streamChat
  ▼
SSE delta / done（done 带 context 统计与 citations）
```

详见 [server/ARCHITECTURE.md](server/ARCHITECTURE.md#5-请求流程)。

---

## 7. 常用命令

| 任务 | 命令 |
| --- | --- |
| server 开发 | `cd server && npm run dev` |
| server 类型检查 | `cd server && npm run typecheck` |
| server 直接启动 | `cd server && npm start` |
| web 开发 | `cd web && npm run dev` |
| web 类型检查 | `cd web && npm run typecheck` |
| web 构建 | `cd web && npm run build` |

---

## 8. 当前限制

- 会话、记忆、知识索引都在内存中，服务重启即清空。
- 没有登录与鉴权，`userId` 不可信。
- 长期记忆默认关闭，且提取结果可能有误，生产环境需要脱敏与审核。
- 知识库只有 BM25，没有向量检索与 rerank。
- Agent 工具循环尚未接入聊天链路。
- 会话列表没有分页，默认只取最近 30 个。
- 没有评估集与自动化测试，上下文策略效果主要靠日志与界面统计观察。

这些限制与后续计划在 [server/ARCHITECTURE.md](server/ARCHITECTURE.md#17-已知限制与下一步) 中有对应说明。

---

## 9. 项目演进

```text
命令行调用模型
    ↓
Express + SSE 全栈聊天
    ↓
服务端会话 + 上下文工程
    ↓
Web 迁移到 session 模式（当前）
    ↓
持久化 / 用户系统 / 向量知识库 / Agent 工具循环（下一步）
```

早期按 `routes / services / types` 组织；2026-10-21 重构为 `api / ai / context / conversation / memory / knowledge / agent`，并完成 Web 端的 session 模式迁移。旧的开发计划与旧版认知地图已被本套文档取代。
