# resolveContextPolicy 说明

> 对应代码：[context.policy.ts](context.policy.ts)
> 关联文件：[context.types.ts](context.types.ts)、[context.builder.ts](context.builder.ts)、[../config/env.ts](../config/env.ts)
> 最后更新：2026-10-22
> 目的：搞清楚这个函数做了什么、13 个返回值分别是什么意思、会影响哪些行为。

---

## 0. 一句话结论

> **它只做配置合并：把「调用方 overrides」和「环境变量 env.context」合成一个 `ContextPolicy` 对象。**
> 它不读会话、不裁剪上下文、不调用模型。

```text
.env + 进程环境变量
        │  启动时读取
        ▼
   env.context
        │
        ▼
resolveContextPolicy(overrides)   ← 纯函数
        │
        ▼
   ContextPolicy（13 个 key）
        │
        ├─ buildContext()      预算、选择、组装
        ├─ searchKnowledge()   检索条数
        └─ scheduleSummary()   摘要触发
```

可以把它理解成上下文工程的**参数表 / 总开关**：所有“带多少历史、留多少输出、要不要摘要、记忆和知识各占多少”都从这里读。

---

## 1. 谁在调用它

| 调用点 | 位置 | 用途 |
| --- | --- | --- |
| `prepareTurn()` | [chat.service.ts L90](../conversation/chat.service.ts#L90) | 每轮对话开始时解析一次，往下传给检索、builder 和摘要 |
| `buildContext()` | [context.builder.ts L81](context.builder.ts#L81) | 调用方没传 `policy` 时的兜底 |
| `summarizeIfNeeded()` | [conversation.summary.ts L129](../conversation/conversation.summary.ts#L129) | 默认参数；正常路径会复用 `prepareTurn` 传入的 policy |

主链路只解析一次：

```text
prepareTurn
  └─ resolveContextPolicy() → policy
       ├─ searchKnowledge(message, policy.knowledgeTopK)
       ├─ buildContext({ ..., policy })
       └─ scheduleSummary(conversationId, policy)
```

所以 `.env` 里的策略影响的是**下一次 `prepareTurn` 调用**，前提是进程已经用新的环境变量重启。

---

## 2. 函数签名与合并规则

```ts
export function resolveContextPolicy(
  overrides: Partial<ContextPolicy> = {},
): ContextPolicy
```

每个字段都是同一套写法：

```ts
overrides.xxx ?? env.context.xxx
```

优先级：

```text
调用方 overrides
  > .env / 进程环境变量
  > env.ts 里 readInt / readFloat / readBoolean 写的默认值
```

注意两点：

1. `??` 只对 `null` / `undefined` 回退，所以 `0`、`false`、`""` 都是有效覆盖值。
2. `systemPrompt` 是唯一例外：

```ts
overrides.systemPrompt
  ?? (env.contextSystemPrompt || DEFAULT_SYSTEM_PROMPT)
```

即：`overrides` > `CONTEXT_SYSTEM_PROMPT` > 代码里的 `DEFAULT_SYSTEM_PROMPT`。

> `.env` 在模块加载时读取一次（[env.ts L70-L74](../config/env.ts#L70-L74) 和 [env.ts L76-L105](../config/env.ts#L76-L105)），运行中修改 `.env` 不会自动生效，需要重启进程。

---

## 3. 返回值速查表（13 个 key）

下表的“默认值”指**没有设置对应环境变量时** `env.ts` 给出的值。

| key | 类型 | 默认值 | 环境变量 | 一句话作用 |
| --- | --- | --- | --- | --- |
| `strategy` | `"full" \| "window" \| "summary-window"` | `"window"` | `CONTEXT_STRATEGY` | 选上下文策略：是否用摘要、历史怎么取 |
| `systemPrompt` | `string` | `DEFAULT_SYSTEM_PROMPT` | `CONTEXT_SYSTEM_PROMPT` | 每条请求最前面的 system 消息 |
| `maxContextTokens` | `number` | `8000` | `CONTEXT_MAX_TOKENS` | 本轮“输入 + 输出”的预算基数 |
| `maxHistoryMessages` | `number` | `20` | `CONTEXT_MAX_MESSAGES` | 最多带多少条历史消息 |
| `reserveOutputTokens` | `number` | `1024` | `CONTEXT_RESERVE_OUTPUT` | 给模型输出预留的 Token |
| `summaryThreshold` | `number` | `0.6` | `CONTEXT_SUMMARY_THRESHOLD` | 历史达到预算多少比例时触发摘要 |
| `summaryKeepTurns` | `number` | `4` | `CONTEXT_SUMMARY_KEEP_TURNS` | 摘要时保留最近几轮原文 |
| `summaryMaxTokens` | `number` | `800` | `CONTEXT_SUMMARY_MAX_TOKENS` | 摘要进入上下文的 Token 上限 |
| `memoryEnabled` | `boolean` | `false` | `MEMORY_ENABLED` | 是否启用长期记忆 |
| `memoryLimit` | `number` | `5` | `MEMORY_LIMIT` | 最多带几条记忆 |
| `memoryBudgetRatio` | `number` | `0.15` | `MEMORY_BUDGET_RATIO` | 记忆预算占 `maxContextTokens` 的比例 |
| `knowledgeTopK` | `number` | `4` | `KNOWLEDGE_TOP_K` | 知识库检索 / 最多带几个分块 |
| `knowledgeBudgetRatio` | `number` | `0.25` | `KNOWLEDGE_BUDGET_RATIO` | 知识库预算占 `maxContextTokens` 的比例 |

---

## 4. 每个 key 具体影响了什么

### 4.1 `strategy`：三种策略

```ts
const strategy = strategyFor(policy);
// strategy.includeSummary
// strategy.maxHistoryMessages(policy)
```

| 策略 | 用摘要 | 历史条数上限 | 实际效果 |
| --- | --- | --- | --- |
| `full` | 否 | `Number.MAX_SAFE_INTEGER` | 忽略 `maxHistoryMessages`，但**仍受 Token 预算约束** |
| `window` | 否 | `maxHistoryMessages` | 默认值，只带最近 N 条 + 预算裁剪 |
| `summary-window` | 是 | `maxHistoryMessages` | 摘要 + 最近 N 条；只有这个策略会生成摘要 |

影响位置：

- [context.builder.ts L82](context.builder.ts#L82)：决定是否插入摘要、历史条数上限。
- [conversation.summary.ts L132](../conversation/conversation.summary.ts#L132)：非摘要策略直接 return，不白跑模型。

**`window` 不是“没有大小限制”**：它同时受两个约束，超出就丢弃旧消息（不摘要）：

```text
maxHistoryMessages（默认 20 条）
Token 预算（available）
```

**运行中会变吗？不会。** 对话轮数、历史消息、摘要都不会修改 `policy.strategy`：

```text
N 轮对话 / 历史长短 / 是否该摘要
        │
        └──✗──→ policy.strategy

strategy 只有两个来源：
  1. 启动时读取的 CONTEXT_STRATEGY
  2. resolveContextPolicy({ strategy: ... }) 的 overrides
```

当前所有调用点都是无参调用（[chat.service.ts L90](../conversation/chat.service.ts#L90)），因此 `strategy` 在进程生命周期内固定。想让已有会话从 `window` 变成 `summary-window`，只能改 `.env` 并重启；代码里没有“聊够 N 轮自动升级策略”的逻辑。

N 轮之后变化的是 `buildContext` 的**结果**，不是 policy：

| 变化 | 发生位置 |
| --- | --- |
| 历史超过 20 条或 Token 预算，旧消息被丢弃 | [context.selector.ts L76-L81](context.selector.ts#L76-L81) |
| `stats.droppedMessages` / `truncated` 变大 | [context.builder.ts L166-L187](context.builder.ts#L166-L187) |
| `summary-window` 下累计 Token 超过阈值，后台生成摘要 | [conversation.summary.ts L52-L72](../conversation/conversation.summary.ts#L52-L72) |
| `window` 下即使超过阈值也不生成摘要 | [conversation.summary.ts L132](../conversation/conversation.summary.ts#L132) |

### 4.2 `systemPrompt`

- 永远是最终消息数组的**第一条** `system` 消息（[context.builder.ts L139](context.builder.ts#L139)）。
- 不会被裁剪；它的 Token 会先算进 `systemTokens`，从总预算里扣掉。
- 放在最前面且保持稳定，有利于 Prompt 缓存；频繁改它会让缓存失效。

### 4.3 `maxContextTokens`：预算的基数

默认 `8000`，允许范围 `512–200000`。

它参与四处计算：

```text
available   = maxContextTokens - reserveOutputTokens - systemTokens
              - currentTokens - safetyMargin

safetyMargin = max(32, 2% × maxContextTokens)

memoryCap    ≤ maxContextTokens × memoryBudgetRatio
knowledgeCap ≤ maxContextTokens × knowledgeBudgetRatio

摘要触发线   = maxContextTokens × summaryThreshold
```

注意：

- 它是**每轮请求**的预算，不是多轮累计。
- `8000` 是项目自己设的“省钱/控延迟”预算，不是模型上限；模型即使支持 1M，也不会自动全部用满。
- 实际发送量通常小于它，剩余预算不会补别的内容。

### 4.4 `maxHistoryMessages`

- 单位是**消息条数**，不是轮数；一条 user + 一条 assistant 算 2 条。
- 默认 `20`，大约等于最近 10 轮。
- 在 [context.selector.ts L76](context.selector.ts#L76) 与 Token 预算同时生效：`selected.length + turn.length > maxMessages` 就停止。
- 从新到旧按“完整轮次”加入，某一轮放不下就停，不会跳过去拿更早的。
- `full` 策略忽略它，但 Token 预算仍然有效。
- 当前用户消息不在历史里，不占这个条数。

### 4.5 `reserveOutputTokens`

- 在分配任何输入内容之前先扣掉，默认 `1024`。
- 太小：模型回答稍长就可能被截断。
- 太大：历史、记忆、知识可用预算变少。

### 4.6 `summaryThreshold`

只对 `summary-window` 生效。

```text
所有 done 消息的估算 Token 总和
  >= maxContextTokens × summaryThreshold
```

默认 `0.6 × 8000 = 4800`：历史累计超过约 4800 Token 才考虑摘要，并且还要满足“可摘要消息 ≥ 2 条”。

### 4.7 `summaryKeepTurns`

- 摘要时保留最近 `summaryKeepTurns × 2` 条消息不摘要（[conversation.summary.ts L47](../conversation/conversation.summary.ts#L47)）。
- 默认 `4`，即最近 8 条（约 4 轮）保留原文，更早的才进入摘要。
- 也会影响触发判断：扣掉保留部分后，剩余可摘要消息不足 2 条就不会摘要。

### 4.8 `summaryMaxTokens`

- 控制**摘要进入上下文时**的上限：

```text
summaryCap = min(summaryMaxTokens, 25% × available)
```

- 摘要文本超出会被 `truncateTextToTokens` 截断。
- 注意：它不是摘要模型的输出上限。摘要生成时用的是 [conversation.summary.ts L16](../conversation/conversation.summary.ts#L16) 里固定的 `SUMMARY_MAX_OUTPUT_TOKENS = 700`。

### 4.9 `memoryEnabled`

它有两个作用点，但**不是同一个开关**：

| 位置 | 行为 |
| --- | --- |
| [context.builder.ts L118](context.builder.ts#L118) | `false` 时 `memoryCap = 0`，即使传了 memories 也不会进入上下文 |
| [memory.service.ts L18](../memory/memory.service.ts#L18)、[L43](../memory/memory.service.ts#L43) | 召回和提取直接检查 `env.context.memoryEnabled` |

所以：

- 想真正开启记忆，必须设置 `MEMORY_ENABLED=true` 并重启。
- 仅通过 `resolveContextPolicy({ memoryEnabled: true })` 覆盖，只会让 builder 允许记忆，不会让 `loadRelevantMemories` / `rememberFromTurn` 工作。

### 4.10 `memoryLimit`

- builder 里限制最多选几条记忆（[context.builder.ts L119](context.builder.ts#L119)）。
- 但召回阶段用的是 `env.context.memoryLimit`（[memory.service.ts L23](../memory/memory.service.ts#L23)），不是 policy 里的值。
- 因此 override 它只影响“最终带几条”，不会改变“召回几条”。

### 4.11 `memoryBudgetRatio`

```text
memoryCap = min(
  maxContextTokens × memoryBudgetRatio,
  35% × 当前剩余 available
)
```

默认 `0.15 × 8000 = 1200`，但剩余预算不足时会更小。记忆和知识都不会挤占当前用户消息与 system prompt。

### 4.12 `knowledgeTopK`

有两处用途：

1. [chat.service.ts L101](../conversation/chat.service.ts#L101)：传给 `searchKnowledge`，决定检索返回多少个候选。
2. [context.builder.ts L129](context.builder.ts#L129)：传给 `selectKnowledge`，决定最终最多带几个分块。

默认 `4`。知识库为空或未配置 `KNOWLEDGE_DIR` 时，实际为 0。

### 4.13 `knowledgeBudgetRatio`

```text
knowledgeCap = min(
  maxContextTokens × knowledgeBudgetRatio,
  50% × 当前剩余 available
)
```

默认 `0.25 × 8000 = 2000`。知识分块会按相关度排序，再按预算截断。

---

## 5. 一次完整调用的返回值（默认配置）

```ts
const policy = resolveContextPolicy();

policy = {
  strategy: "window",

  systemPrompt: [
    "你是一名专业的前端技术导师。",
    "回答要准确、简洁、可执行；涉及代码时给出关键片段并解释原因。",
    "如果参考资料与问题无关，不要强行引用。",
  ].join("\n"),

  maxContextTokens: 8000,
  maxHistoryMessages: 20,
  reserveOutputTokens: 1024,

  summaryThreshold: 0.6,
  summaryKeepTurns: 4,
  summaryMaxTokens: 800,

  memoryEnabled: false,
  memoryLimit: 5,
  memoryBudgetRatio: 0.15,

  knowledgeTopK: 4,
  knowledgeBudgetRatio: 0.25,
};
```

如果 `.env` 里设置了对应变量，值会被替换；例如：

```dotenv
CONTEXT_STRATEGY=summary-window
CONTEXT_MAX_TOKENS=32000
CONTEXT_MAX_MESSAGES=40
MEMORY_ENABLED=true
```

则返回对象里的 `strategy`、`maxContextTokens`、`maxHistoryMessages`、`memoryEnabled` 会对应变化。

---

## 6. 这些 key 一起怎么算（默认值的例子）

假设：

- 默认 `window` 策略；
- system prompt 约 69 Token；
- 当前问题约 17 Token；
- 没有摘要、记忆、知识。

```text
maxContextTokens = 8000
reserveOutput    = 1024
systemTokens     = 69
currentTokens    = 17
safetyMargin     = max(32, 2% × 8000) = 160

available = 8000 - 1024 - 69 - 17 - 160 = 6730
```

`available` 全部留给历史，同时受 `maxHistoryMessages = 20` 约束。

如果开启 `summary-window`、记忆和知识，则从 `available` 里依次再扣：

```text
summary   ≤ min(800, 25% × available)
memory    ≤ min(8000 × 0.15, 35% × 剩余)
knowledge ≤ min(8000 × 0.25, 50% × 剩余)
history   = 最后剩下的
```

关键不是“把 8000 填满”，而是**先保证 system 和当前问题，再按优先级分配，超了就停**。

---

## 7. `overrides` 怎么用

当前主链路调用的是无参版本：

```ts
// chat.service.ts L90
const policy = resolveContextPolicy();
```

`overrides` 主要用于测试、调试或未来的“按请求切换策略”：

```ts
resolveContextPolicy({
  strategy: "summary-window",
  maxContextTokens: 32000,
  maxHistoryMessages: 40,
});

resolveContextPolicy({
  maxHistoryMessages: 4,
  memoryEnabled: false,
});
```

如果想让某个 HTTP 请求临时指定策略，需要改 [chat.service.ts L90](../conversation/chat.service.ts#L90) 的调用方式，把请求参数传进 `prepareTurn`；目前没有暴露这个入口。

---

## 8. 常见误解

| 误解 | 实际情况 |
| --- | --- |
| `resolveContextPolicy()` 会裁剪历史 | 不会。它只合并配置；裁剪在 `buildContext` / `selectHistory` |
| `maxContextTokens = 8000` 表示每轮固定发 8000 Token | 不是。它是上限，实际通常更少，剩余预算不会自动填满 |
| 8000 是模型窗口上限 | 不是。模型可能支持 1M，8000 是项目自己设的成本/延迟预算 |
| 改 `.env` 后下一轮立即生效 | 不会。环境变量在进程启动时读取，需要重启 |
| `full` 策略完全不限历史 | 只忽略 `maxHistoryMessages`，Token 预算仍然生效 |
| 聊够 N 轮后 `window` 会自动变成 `summary-window` | 不会。`strategy` 只来自 `CONTEXT_STRATEGY` 或 `overrides`；历史只影响裁剪结果 |
| override `memoryEnabled: true` 就能开启记忆 | 召回/提取检查的是 `env.context.memoryEnabled`，必须设 `MEMORY_ENABLED=true` |
| override `memoryLimit` 能控制召回条数 | 召回用 `env.context.memoryLimit`；policy 只控制最终选几条 |
| `summaryMaxTokens` 控制摘要模型的输出长度 | 摘要生成上限固定为 700；这个值控制摘要进入上下文的长度 |
| `overrides` 传 `0` / `false` 会被默认值覆盖 | 不会。用的是 `??`，只对 `null` / `undefined` 回退 |

---

## 9. 代码地图

| 关注点 | 位置 |
| --- | --- |
| 默认 system prompt | [context.policy.ts L8-L12](context.policy.ts#L8-L12) |
| 三种策略定义 | [context.policy.ts L14-L30](context.policy.ts#L14-L30) |
| `resolveContextPolicy` | [context.policy.ts L32-L58](context.policy.ts#L32-L58) |
| `strategyFor` | [context.policy.ts L60-L62](context.policy.ts#L60-L62) |
| `ContextPolicy` 类型 | [context.types.ts L47-L71](context.types.ts#L47-L71) |
| 环境变量默认值与范围 | [../config/env.ts L88-L104](../config/env.ts#L88-L104) |
| 预算分配 | [context.builder.ts L80-L136](context.builder.ts#L80-L136) |
| 历史条数与预算选择 | [context.selector.ts L55-L93](context.selector.ts#L55-L93) |
| 摘要触发与保留轮次 | [conversation.summary.ts L30-L72](../conversation/conversation.summary.ts#L30-L72) |
| 记忆开关检查 | [memory.service.ts L18](../memory/memory.service.ts#L18)、[L43](../memory/memory.service.ts#L43) |
| 知识检索入口 | [knowledge.service.ts L38-L55](../knowledge/knowledge.service.ts#L38-L55) |

---

## 10. 一页总结

```text
做什么：合并 overrides + env.context，返回 ContextPolicy
不做什么：不读会话、不裁剪、不调模型
优先级：overrides > .env > env.ts 默认值（用 ??，0/false 有效）
返回：13 个 key，分四组
  策略：strategy、systemPrompt
  预算：maxContextTokens、maxHistoryMessages、reserveOutputTokens
  摘要：summaryThreshold、summaryKeepTurns、summaryMaxTokens
  记忆/知识：memoryEnabled、memoryLimit、memoryBudgetRatio、
             knowledgeTopK、knowledgeBudgetRatio
影响：buildContext 的预算与组装、searchKnowledge 的条数、摘要是否触发
注意：maxContextTokens 是每轮上限，不是模型上限；改 .env 要重启
```
