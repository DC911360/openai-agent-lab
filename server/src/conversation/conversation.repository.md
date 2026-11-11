# ConversationRepository 说明

> 对应代码：[conversation.repository.ts](conversation.repository.ts)
> 关联文件：[conversation.service.ts](conversation.service.ts)、[conversation.types.ts](conversation.types.ts)
> 最后更新：2026-10-22
> 目的：不逐行读代码，也能知道会话数据存在哪里、每个方法做了什么、有什么坑。

---

## 0. 一句话结论

> **当前所有会话数据都存在 server 进程内存的 `Map` 里。**
> 服务重启、进程退出、换一个 server 实例，数据就没了。

```text
HTTP 请求
  → conversation.service.ts
  → conversationRepository（单例）
  → InMemoryConversationRepository
  → Map<string, Conversation>
```

---

## 1. 接口 vs 实现

你看到的 `ConversationRepository` 只是**接口/契约**，它不决定数据存在哪里：

```ts
export interface ConversationRepository {
  create(input: CreateConversationInput): Promise<Conversation>;
  get(id: string): Promise<Conversation | null>;
  list(options: { userId?: string; limit: number }): Promise<ConversationSummary[]>;
  update(id: string, patch: ConversationPatch): Promise<Conversation | null>;
  appendMessage(id: string, message: ConversationMessage): Promise<Conversation | null>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
  clear(): Promise<void>;
}
```

当前实现是内存版：

```ts
export class InMemoryConversationRepository implements ConversationRepository {
  private readonly conversations = new Map<string, Conversation>();
}

export const conversationRepository = new InMemoryConversationRepository();
```

对应位置：

| 内容 | 行号 |
| --- | --- |
| `MAX_CONVERSATIONS = 200` | [conversation.repository.ts L9](conversation.repository.ts#L9) |
| Repository 接口 | [conversation.repository.ts L24-L36](conversation.repository.ts#L24-L36) |
| 内存实现类 | [conversation.repository.ts L38-L174](conversation.repository.ts#L38-L174) |
| 对外单例 | [conversation.repository.ts L176](conversation.repository.ts#L176) |

所有 service 方法最终都调用这个单例：

```text
createConversation        → conversationRepository.create
getConversation           → conversationRepository.get
listConversations         → conversationRepository.list
renameConversation        → conversationRepository.update
appendMessage             → conversationRepository.appendMessage
deleteConversation        → conversationRepository.delete
conversationCount         → conversationRepository.count
```

---

## 2. 数据结构

```text
Map<string, Conversation>
  │  key = conversationId
  │  value = Conversation
  ▼
Conversation {
  id: string
  userId?: string
  title: string
  createdAt: string
  updatedAt: string
  summary?: string
  summaryUpToMessageId?: string
  summaryUpdatedAt?: string
  metadata?: Record<string, unknown>
  messages: ConversationMessage[]
}

ConversationMessage {
  id: string
  role: "user" | "assistant"
  content: string
  status: "done" | "aborted" | "error"
  createdAt: string
  usage?: { prompt_tokens, completion_tokens, total_tokens }
  model?: string
  metadata?: Record<string, unknown>
}
```

所以 user / assistant 消息也在同一个 `Map` 的值里，没有单独的 messages 表。

---

## 3. 八个方法分别做什么

### 3.1 `create`

```ts
create(input: CreateConversationInput): Promise<Conversation>
```

做了什么：

1. 生成 `randomUUID()` 作为会话 ID；
2. 创建 `Conversation` 对象；
3. `Map.set(id, conversation)`；
4. 如果会话数超过 200，淘汰 `updatedAt` 最旧的会话；
5. 返回 `structuredClone` 副本。

注意：

- `title` 不传时默认是 `"新会话"`；
- `userId` 可选，仅用于过滤，不代表鉴权；
- 返回的是副本，修改它不会影响 `Map` 内部数据。

### 3.2 `get`

```ts
get(id: string): Promise<Conversation | null>
```

做了什么：

1. `Map.get(id)`；
2. 找到就返回 `structuredClone` 副本，找不到返回 `null`。

注意：

- 返回的是副本；直接改返回值不会持久化；
- 想修改数据必须走 `update` / `appendMessage`；
- `conversation.service.ts` 的 `getConversation()` 会在 `null` 时抛 404。

### 3.3 `list`

```ts
list(options: { userId?: string; limit: number }): Promise<ConversationSummary[]>
```

做了什么：

1. 遍历 `Map.values()`；
2. 如果传了 `userId`，只保留该用户的会话；
3. 按 `updatedAt` 倒序；
4. 截取 `limit` 条；
5. 转成 `ConversationSummary`（不返回完整 messages）。

`ConversationSummary` 包含：

- `id` / `userId` / `title` / `createdAt` / `updatedAt`
- `summary` / `summaryUpdatedAt`
- `messageCount`
- `lastMessage`（只截取前 200 字符）

注意：

- 列表接口不会把所有消息都返回，避免 payload 过大；
- 排序依据是 `updatedAt`，发消息、改标题、更新摘要都会改变它。

### 3.4 `update`

```ts
update(id: string, patch: ConversationPatch): Promise<Conversation | null>
```

`patch` 只允许这些字段：

```ts
{
  title?: string;
  summary?: string;
  summaryUpToMessageId?: string;
  summaryUpdatedAt?: string;
}
```

做了什么：

1. `Map.get(id)`，不存在返回 `null`；
2. `Object.assign(conversation, patch)`；
3. 更新 `updatedAt`；
4. 返回副本。

使用场景：

- `renameConversation()` 改标题；
- `updateSummary()` 更新摘要和摘要覆盖位置。

注意：

- 不能通过它追加消息；
- 不能改 `createdAt` / `id` / `messages`。

### 3.5 `appendMessage`

```ts
appendMessage(id: string, message: ConversationMessage): Promise<Conversation | null>
```

做了什么：

1. `Map.get(id)`，不存在返回 `null`；
2. `conversation.messages.push(message)`；
3. `updatedAt = message.createdAt`；
4. 如果标题还是默认的 `"新会话"` 且这是 user 消息，用消息内容生成标题（最多 30 字）；
5. 返回副本。

注意：

- user 和 assistant 都走这个方法；
- 标题只在“默认标题 + 第一条 user 消息”时自动生成；
- 单个会话的消息数量目前没有上限；
- 返回副本，但消息已经写入 `Map`。

### 3.6 `delete`

```ts
delete(id: string): Promise<boolean>
```

做了什么：

- `Map.delete(id)`；
- 返回 `true` 表示删除了，`false` 表示不存在。

注意：

- 消息没有单独存储，所以删除会话就是删除整个 `Conversation`；
- `conversation.service.ts` 的 `deleteConversation()` 会在 `false` 时抛 404。

### 3.7 `count`

```ts
count(): Promise<number>
```

做了什么：

- 返回 `Map.size`，即当前会话数量。

使用场景：

- `GET /api/health` 返回 `conversations` 字段；
- 不返回消息总数。

### 3.8 `clear`

```ts
clear(): Promise<void>
```

做了什么：

- `Map.clear()`，删除所有会话。

注意：

- 目前没有对外 HTTP 路由；
- 主要用于内部测试或重置；
- 调用后所有会话和消息都会丢失。

---

## 4. 内存实现的边界

### 4.1 重启即清空

```text
server 启动 → Map 为空
运行中     → 会话写入 Map
重启/退出  → Map 随进程销毁
```

前端 `localStorage` 里可能还留着 `conversationId`，但服务端已经查不到：

```text
GET /api/conversations/:id → 404
前端 → 清除 localStorage → 回到新会话
```

### 4.2 多实例不共享

```text
实例 A 的 Map ≠ 实例 B 的 Map
```

如果部署多个 Node 进程并做负载均衡，同一个 `conversationId` 请求到另一个实例就会 404。

### 4.3 最多 200 个会话

`MAX_CONVERSATIONS = 200`。

- 只在新会话创建时检查；
- 超过后按 `updatedAt` 淘汰最旧的；
- 会打印 `[conversation] 会话数超过 200，已淘汰最旧会话 ...`。

### 4.4 消息数量没有上限

单个会话的 `messages` 数组会一直增长。

- 当前依赖上下文工程的窗口/摘要来控制发给模型的量；
- 但**存储**本身不会自动裁剪消息；
- 生产环境需要设置保留策略或分页。

---

## 5. 不只是会话在内存

| 数据 | 存储位置 | 重启后 |
| --- | --- | --- |
| 会话与消息 | `conversation.repository.ts` 的 `Map` | 丢失 |
| 长期记忆 | `memory/memory.store.ts` 的 `Map` | 丢失 |
| 知识库索引 | `knowledge/knowledge.store.ts` 的内存索引 | 丢失，启动时从 `KNOWLEDGE_DIR` 重新加载 |
| 请求日志 | `api/log-store.ts` 的数组 | 丢失 |
| 进行中请求 | `api/active-requests.ts` 的 `Map` | 丢失 |
| 会话锁 | `api/conversation-locks.ts` 的 `Set` | 丢失 |

---

## 6. 为什么接口是异步的

方法是 `Promise`，不是因为当前内存操作需要异步，而是为了未来替换实现：

```text
ConversationRepository（接口）
  ├─ InMemoryConversationRepository（当前）
  ├─ SqliteConversationRepository（未来）
  └─ RedisConversationRepository（未来）
```

换成 SQLite/Redis 时：

1. 新建一个类实现 `ConversationRepository`；
2. 替换 `export const conversationRepository = ...`；
3. `conversation.service.ts` 和 API 层不用改。

---

## 7. 如果要做持久化，改哪里

### 7.1 新增实现

```ts
export class SqliteConversationRepository implements ConversationRepository {
  // create / get / list / update / appendMessage / delete / count / clear
}
```

### 7.2 替换单例

```ts
export const conversationRepository = new SqliteConversationRepository();
```

### 7.3 建议的表结构

```text
conversations
  id, user_id, title, created_at, updated_at,
  summary, summary_up_to_message_id, summary_updated_at, metadata

messages
  id, conversation_id, role, content, status,
  created_at, usage_json, model, metadata
```

### 7.4 需要保证的行为

- `get(id)` 返回会话 + 该会话的全部消息；
- `appendMessage` 在事务中插入消息并更新 `conversations.updated_at`；
- `list` 只查摘要字段，不联查全部消息；
- `delete` 同时删除会话和消息（或使用外键级联）；
- `count` 只统计会话数；
- `clear` 在测试环境使用，生产环境慎用。

---

## 8. 常见误解

| 误解 | 实际情况 |
| --- | --- |
| 会话存在数据库里 | 当前存在进程内存的 `Map` 里 |
| `get` 返回的是内部对象，改了就生效 | 返回 `structuredClone` 副本，必须走 `update`/`appendMessage` |
| `delete` 需要单独删消息 | 消息在 `Conversation.messages` 里，删除会话就一起删了 |
| `clear` 有 HTTP 接口 | 没有，只有 Repository/Service 内部方法 |
| 多个浏览器标签页会各存一份 | 同一 server 进程共享同一个 `Map`；不同 server 实例不共享 |
| 会话数没有上限 | 最多 200 个，超出淘汰最旧 |
| 单个会话消息会自动裁剪 | 不会，存储层不裁剪；只有发给模型的上下文会被裁剪 |

---

## 9. 代码地图

| 关注点 | 位置 |
| --- | --- |
| 最大会话数 | [conversation.repository.ts L9](conversation.repository.ts#L9) |
| Repository 接口 | [conversation.repository.ts L24-L36](conversation.repository.ts#L24-L36) |
| 内存实现 | [conversation.repository.ts L38-L174](conversation.repository.ts#L38-L174) |
| 对外单例 | [conversation.repository.ts L176](conversation.repository.ts#L176) |
| Service 封装 | [conversation.service.ts L12-L97](conversation.service.ts#L12-L97) |
| 会话路由 | [../api/conversations.ts](../api/conversations.ts) |
| 健康检查计数 | [../api/health.ts](../api/health.ts) |

---

## 10. 一页总结

```text
存哪里：当前 server 进程内存的 Map<string, Conversation>
存什么：Conversation + messages[]
重启后：全部丢失
多实例：不共享
上限：200 个会话；单会话消息无上限
返回：get/update/appendMessage 返回 structuredClone 副本
未来：实现 SqliteConversationRepository，替换单例即可
```
