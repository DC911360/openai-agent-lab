# Web 前端

Vue 3 + TypeScript + Vite 聊天界面，对接 `server` 的 `/api/chat`。

## 启动

要求：Node.js 20+；先启动 `server`（默认 `http://127.0.0.1:3001`）。

```bash
cd web
npm install
npm run dev
```

打开 `http://localhost:5173`。

`vite.config.ts` 已配置代理：

```text
/api → http://127.0.0.1:3001
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器（5173） |
| `npm run typecheck` | `vue-tsc -b` 类型检查 |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run preview` | 预览构建产物 |

## 目录

```text
web/src/
├── main.ts                     # 创建 Vue 应用
├── App.vue                     # 挂载 ChatPanel
├── api/chat.ts                 # 聊天请求、abort 请求
├── composables/useChatStream.ts # 消息状态、SSE 解析、发送/停止
├── components/
│   ├── ChatPanel.vue           # 页面容器、消息列表、输入区
│   ├── MessageItem.vue         # 单条消息与状态
│   └── MarkdownContent.vue     # marked + DOMPurify
├── types/chat.ts               # 消息与 SSE 事件类型
└── assets/styles.css
```

## 当前请求模式：session

前端每轮只发送当前用户消息，历史由服务端维护：

```json
{
  "conversationId": "uuid（可选）",
  "message": "只回复两个字：收到",
  "stream": true
}
```

行为：

- 第一轮不带 `conversationId`，服务端自动创建会话，并通过 `X-Conversation-Id` 响应头返回。
- 前端把 `conversationId` 保存到 `localStorage`（key：`openai-agent-lab:conversationId`）。
- 后续轮次只发送当前消息，payload 不再随历史增长。
- 刷新页面时读取该 ID，调用 `GET /api/conversations/:id` 恢复消息；ID 失效则回到新会话。
- 左侧会话列表支持新建、切换、重命名、删除；数据来自 `GET /api/conversations`。

服务端返回的 `done` 事件还包含：

- `context`：本次上下文统计（包含/丢弃条数、各区域 Token、是否使用摘要/记忆/知识）。
- `citations`：知识库引用来源。
- `conversationId`：实际使用的会话 ID。

前端会把 `context` 和 `citations` 展示在助手消息下方，用于观察上下文工程的效果。

### SSE 解析要点

- 用 `fetch` + `ReadableStream` 读取，不能用 `EventSource`（它只支持 GET）。
- 必须维护缓冲区，按 `\n\n` 切分事件，不能假设每次 `read()` 正好是一个事件。
- 事件类型：`delta` / `done` / `aborted` / `error`。
- 连接结束但没有收到 `done` 或 `aborted`，应视为异常结束。
- 中断时调用 `POST /api/chat/abort { requestId }`，失败再回退为直接断开连接。

## Stateless 兼容模式

服务端仍保留旧接口：

```json
{
  "messages": [
    { "role": "user", "content": "..." }
  ],
  "stream": true
}
```

用于旧客户端、调试和上下文策略对比。当前 Web 已不再使用它。

## 相关实现

| 文件 | 职责 |
| --- | --- |
| `src/api/chat.ts` | session 聊天、abort、会话 CRUD 请求 |
| `src/composables/useChatStream.ts` | 消息状态、SSE 解析、会话恢复与切换 |
| `src/components/ChatPanel.vue` | 会话列表、聊天布局、输入与停止生成 |
| `src/types/chat.ts` | 会话、上下文统计、引用与 SSE 事件类型 |

完整的服务端接口见 [server/ARCHITECTURE.md](../server/ARCHITECTURE.md#12-api-参考)。

## 相关文档

- [项目说明](../README.md)
- [项目目录](../PROJECT_STRUCTURE.md)
- [Server 架构](../server/ARCHITECTURE.md)
- [上下文管理设计](../CONTEXT_MANAGEMENT_DESIGN.md)
