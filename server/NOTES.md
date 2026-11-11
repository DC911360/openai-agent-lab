# Server 学习笔记

> 记录依赖、dotenv、OpenAI SDK 响应结构、SSE 基础等学习内容。
> 这不是架构文档；当前架构见 [ARCHITECTURE.md](ARCHITECTURE.md)，项目目录见 [PROJECT_STRUCTURE.md](../PROJECT_STRUCTURE.md)。

## 1. 每个依赖的职责

| 依赖 | 职责 |
| --- | --- |
| openai | 使用统一的 SDK 调用兼容接口的模型服务 |
| dotenv | 加载本地 .env 环境变量 |
| typescript | TypeScript 编译与类型检查 |
| tsx | 开发期间直接运行 TypeScript |
| @types/node | Node.js API 的类型定义 |

---

建立一个很重要的工程认知：

- package.json：声明项目依赖、模块类型和可执行脚本。
- node_modules：存放实际安装的包。
- package-lock.json：记录依赖解析结果，帮助保持安装一致性。
- tsconfig.json：控制 TypeScript 的类型检查和模块解析行为。
- tsx：负责开发时运行 TypeScript，并不是 TypeScript 编译器本身。

下一步 会将 `src/index.ts` 从单纯打印日志，改成真正的模型调用

```text
 读取环境变量
    ↓
创建 OpenAI SDK 客户端
    ↓
配置 DeepSeek API 地址
    ↓
发送 message
    ↓
等待模型响应
    ↓
读取 choices[0].message.content

```

## 2. dotenv 的作用

.env 文件存在，不代表 Node.js 已经读取了它。
如果没有其他配置注入机制，也没有使用 `dotenv` 或 Node.js 原生的 `.env` 加载能力，那么：

```ts
console.log("process.env.DEEPSEEK_API_KEY");
//undefined
```

这就是`dotenv` 解决的核心问题

## 3. dotenv 的职责

`dotenv` 是一个 Node.js 第三方 npm 包，主要负责：

1. 读取执行的 .env 文件。
2. 解析文件中的环境变量配置
3. 将解析出来的变量写入 `process.env`
4. 让你的业务代码统一的 `process.env` 接口方式读取这些配置
   可以把它理解成一个环境变量加载器

执行的过程

```text
    .env 文件 DEEPSEEK_API_KEY= 密钥
                ↓
    dotenv 读取文件-> 解析键值对 -> 写入环境变量中
                ↓
    process.env DEEPSEEK_API_KEY -> 对应的字符串值
                ↓
    Node.js 业务代码 const apiKey = process.env.DEEPSEEK_API_KEY

```

重要的一点：
dotenv 不会替换 process.env, 也不会创建一个新的环境变量 API。他只是把 .env 文件里的配置加载到 process.env 中。

## 4. .env、process.env、dotenv 三者区别

| 概念 | 本质 | 负责什么 |
| --- | --- | --- |
| `.env` | 一个文本文件 | 保存配置内容 |
| `process.env` | Node.js 提供的环境变量接口 | 读取当前进程可访问的环境变量 |
| `dotenv` | 第三方包 | 将 `.env` 文件中的配置加载到 `process.env` |

业务只关心 `process.env` ,不必关心变量最初来自 `.env`、操作系统、还是 Docker、CI/CD 等 其他来源

### 4.1 dotenv 的原理

`.env` → `dotenv.config()` 读取 `.env` 文件 → `parse()` 解析为键值对 → `populate()` 填充（默认行为：相同 key 不覆盖；`override: true` 时以填充值为准）→ `process.env` → 业务代码。

## 5. OpenAI 兼容格式的 Chat Completions 返回对象

```js
{
    id: '993a7252-3b3b-44eb-8573-1bfdc4fee584',
    object: 'chat.completion',
    created: 1792467500,
    model: 'deepseek-flash',
    choices: [
        {
        index: 0,
        message: [
            {
                role:"assistant",
                content:""，
                reasoning_content:"",
            }
        ],
        logprobs: null,
        finish_reason: 'stop'
        }
    ],
    usage: {
        prompt_tokens: 47,
        completion_tokens: 69,
        total_tokens: 116,
        prompt_tokens_details: { cached_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 26 },
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 47
    },
    system_fingerprint: 'e72d3c7f663d3e1383b00b3884cb4501'
}

// choices 模型生成的回答及结束状态  choices[0].message
// usage 本次请求消耗了多少 Token， 缓存命中情况如何 usage.total_tokens
// id/object/created/model/system_fingerprint 请求标志、响应类型、时间、模型信息及系统指纹

```

| key | 含义 | 业务用途|
|-----|------|-------|
|index| 当前候选回答的索引，从 0开始| 区分多个候选答案|
|message | 模型生成的消息，通常包含 role、content 等字段| 业务最核心的数据|
|logprobs | 与输出Token 相关的对数概率信息| 特性评估|
|finish_reason| 模型本次生成结束的原因| 判断是否正常结束、是否达到限制等|

finish_reason 值的重点理解：
| 值  | 含义|
|----|-----|
|stop| 正常结束，例如生成到结束标记|
|length| 达到输出Token 长度限制|
|tool_calls| 模型请求调用工具，常见于 Agent 场景|
|content_filter| 输出因内容过滤而终止（具体支持情况取决于接口）|


usage: Token 用量统计
这是理解模型调用成本、性能和缓存机制时非常重要的一部分。

输入 Token：47  prompt_tokens
输出 Token：69  completion_tokens
总计 Token 116  total_tokens

47 + 69 = 116。Token 是模型的文本处理单位，不等于字符数或单词数。

| Key |  含义 | 数量 |
|-----|-------|-----|
|prompt_tokens| 输入给模型的 Token 数，通常包含消息以及项目相关内容 | 47|
|completion_tokens| 模型生成的 Token 数| 69|
|total_tokens| 输入和输出 Token总数| 116|
|prompt_tokens_details.cached_tokens|输入 Token 中被缓存复用的数量|0|
|completion_tokens_details.reasoning_tokens|推理 Token数，具体统计口径由模型提供商决定| 26|
|prompt_cache_hit_tokens| 服务端报告的提示词缓存命中 Token 数| 0|
|prompt_cache_miss_tokens| 服务端报告的提示词缓存未命中 Token数| 47|

- total_tokens: 统计整体 Token 用量
- prompt_tokens: 分析输入上下文是否过大
- completion_tokens:分析模型输出规模
- reasoning_tokens: 在支持该字段的模型上，观察推理用量
- 缓存字段：评估重复上下文的缓存效果


`choices[0].message` 是消息主体；
`finish_reason` 是结束原因
`usage` 是用量统计
`id`、`model`、`created` 用于追踪与分析；缓存字段和推理 Token 用于理解成本、缓存和模型行为。

completion 是完整响应；
choices 是模型回答结果；
usage 是本次调用模型的用量账单
其他顶层字段主要帮助你识别、追踪和分析调用


- SDK（Software Development Kit，软件开发工具包）
- Client（客户端）：你的程序中负责与远程服务交互的对象。

## 6. Streaming 和 SSE 是什么关系？

这两个概念经常一起出现，但它们不是同一个东西。

| 概念 | 解决什么问题 | 本质 |
| --- | --- | --- |
| Streaming 流式响应 | 如何逐步交付数据 | 一种数据交付方式 |
| SSE（Server-Sent Events） | 如何组织和传输事件 | 一种基于 HTTP 的事件流机制 |
| fetch() | 如何发送 HTTP 请求并读取响应 | Web API |
| ReadableStream | 如何逐步读取响应式数据 | 流式数据接口 |

可以理解：

模型服务持续产生结果
   ⬇️
HTTP 流式传输 数据逐步抵达客户端
⬇️
SSE 事件格式 例如 data:, 用空行分割事件
⬇️
客户端读取与解析 fetch -> ReadableStream -> 解码 -> 解析事件 -> 更新UI

SSE 是一种流式传输方案，但流式响应不一定使用 SSE。也可以使用 WebSocket、其它流转协议或者自定义协议

SSE 的核心规则：

- `data:` 表示事件的数据字段
- `\n\n` 表示一个事件结束，即两个换行符构成的事件边界
- 一个事件可以包含多行 `data:` 字段
- `[DONE]` 是很多模型 API 使用的结束标记，但它不是 SSE 协议本身规定的通用结束标记

HTTP 每次传输到客户端的数据块，不一定刚好对应一个 SSE 事件。

```text
    数据块 1:
    data:{"content":"闭}

    数据2:
    包"}\n\n
```

所以，客户端不能简单把每次 `reader.read()` 读取到的内容直接当成一个完整事件。这是流式解析中容易出错的地方。

## 7. Node.js 如何开启模型的流式响应

```ts
    const completions = await client.chat.completions.create({
        model:"deepseek-chat",
        messages:[
            { role:"user",content:"请解释 JavaScript 闭包" }
        ],
        stream:true,
    })

    for await (const chunk of completion){
        const content = chunk.choices[0]?.delta?.content;

        if(content){
            process.stdout.write(content)
        }
    }
```