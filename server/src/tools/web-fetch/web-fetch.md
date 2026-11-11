# Web Fetch 工具说明

> 对应代码：[web-fetch.ts](web-fetch.ts)
> 类型定义：[types.ts](types.ts)
> 示例脚本：[web-fetch.test.ts](web-fetch.test.ts)
> 最后更新：2026-10-29
> 目的：说明 `webFetch` 的三种抓取方式、Chrome 渲染流程、配置与安全边界。

---

## 0. 一句话结论

> **默认 `auto`：先 HTTP，正文为空/过短时自动调用本机 Chrome 渲染后再提取正文。**

```text
webFetch({ url, render })
  ├─ render: "http"     → fetch + 解析原始 HTML
  ├─ render: "browser"  → 无头 Chrome 执行 JS + 解析渲染后的 DOM
  └─ render: "auto"     → 先 http，正文为空/过短再回退 browser
```

---

## 1. 调用方式

```ts
import { webFetch } from "./web-fetch.js";

const result = await webFetch({
  url: "https://example.com/",
  render: "auto",
});

console.log(result.renderMode); // "http" | "browser"
console.log(result.title);
console.log(result.content);
```

`render` 不传时默认 `"auto"`。需要强制只走 HTTP 时可显式传 `"http"`。

---

## 2. 输入与输出

### 2.1 `WebFetchInput`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | `string` | 是 | 只允许 `http:` / `https:`，且不能是本机或私有 IPv4 |
| `render` | `"http" \| "browser" \| "auto"` | 否 | 默认 `"auto"` |

### 2.2 `WebFetchResult`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `url` | `string` | 请求地址 |
| `status` | `number` | HTTP 状态码；浏览器模式固定为 `200` |
| `title` | `string \| undefined` | `<title>` 提取结果 |
| `content` | `string` | 去标签后的正文，最多 20,000 字符 |
| `renderMode` | `"http" \| "browser"` | 实际使用的抓取方式 |

---

## 3. 三种模式

| 模式 | 执行 JS | 重定向 | 速度 | 适用 |
| --- | --- | --- | --- | --- |
| `http` | 否 | `manual`，3xx 直接报错 | 快（约 0.2–1 秒） | 服务端渲染的静态 HTML |
| `browser` | 是 | 由 Chrome 自动跟随 | 慢（约 5–15 秒） | SPA、JS 渲染、反爬空壳页 |
| `auto` | 视情况 | 先 HTTP，必要时浏览器 | 介于两者之间 | 不确定页面类型时 |

### 3.1 `http`

- 请求头：`User-Agent: openai-agent-lab/1.0`；
- 只接受 `text/html` / `application/xhtml+xml`；
- 10 秒超时；
- 不跟随重定向；
- 拿到什么 HTML 就解析什么，`<script>` 里的内容会被删掉。

### 3.2 `browser`

- 用本机 Chrome 的 `--headless=new` 模式；
- 等待页面执行 JS，`--virtual-time-budget=15000`；
- `--dump-dom` 输出渲染后的 DOM；
- 再用同一套 `extractTitle` / `extractText` 提取；
- 30 秒进程超时，DOM 输出上限 32 MB；
- 使用临时 `user-data-dir`，抓完即删，不复用登录态。

### 3.3 `auto`

```text
1. 先跑 http
2. HTTP 成功且正文 >= 80 字符 → 直接返回 http 结果
3. 正文为空/过短，或 HTTP 报错 → 跑 browser
4. browser 失败：
   - http 有非空正文 → 返回 http 结果
   - http 也没有正文 → 抛出组合错误
```

`80` 字符是启发式阈值，不是精确的“是否 JS 渲染”判断。纯导航页、错误页可能误判。

---

## 4. 浏览器模式的处理流程

```text
validateUrl(url)
  │
  ├─ 只允许 http/https，拦截 localhost / 127.x / 10.x / 192.168.x / 172.16-31.x
  ▼
resolveChromePath()
  │
  ├─ CHROME_PATH
  ├─ macOS / Linux / Windows 常见安装路径
  └─ PATH 里的 google-chrome / chromium
  ▼
mkdtemp(临时 user-data-dir)
  ▼
chrome --headless=new ... --dump-dom URL
  ▼
extractTitle(html) + extractText(html)
  ▼
rm -rf 临时 user-data-dir
```

### 4.1 User-Agent

浏览器模式会读取本机 Chrome 主版本号，拼一个普通 Chrome UA：

```text
Mozilla/5.0 (<platform>) AppleWebKit/537.36 (KHTML, like Gecko)
Chrome/<major>.0.0.0 Safari/537.36
```

这样不会暴露默认的 `HeadlessChrome` 标记。同时设置：

```text
--lang=zh-CN
--accept-lang=zh-CN,zh;q=0.9,en;q=0.8
```

它能让部分站点返回正常页面，但**不保证绕过登录、验证码或行为风控**。

### 4.2 为什么不用 `--disable-background-networking`

实测在头条这类带 JS challenge 的页面上，加上：

```text
--disable-background-networking
--disable-extensions
--disable-sync
--metrics-recording-only
```

Chrome 会一直等到进程超时也不输出 DOM。因此这些“优化”参数没有启用，只保留必要参数。

---

## 5. 配置

| 环境变量 | 作用 |
| --- | --- |
| `CHROME_PATH` | 指定 Chrome/Chromium 可执行文件；优先级最高 |
| `CHROME_NO_SANDBOX=1` | 给 Chrome 加 `--no-sandbox`；容器内以 root 运行时可使用 |

默认查找顺序：

```text
CHROME_PATH
  → /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  → /Applications/Chromium.app/Contents/MacOS/Chromium
  → ~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  → /usr/bin/google-chrome
  → /usr/bin/google-chrome-stable
  → /usr/bin/chromium
  → /usr/bin/chromium-browser
  → /snap/bin/chromium
  → PATH: google-chrome / google-chrome-stable / chromium / chromium-browser
  → Windows 常见安装目录
```

找不到 Chrome 时，`browser` / `auto` 会抛出明确错误，`http` 不受影响。

---

## 6. 怎么运行示例

```bash
cd server
./node_modules/.bin/tsx src/tools/web-fetch/web-fetch.test.ts
```

示例脚本当前使用：

```ts
const result = await webFetch({
  url: "https://zhuanlan.zhihu.com/p/25964484",
  render: "browser",
});
```

改成 `render: "http"` 或 `render: "auto"` 可以对比三种模式。

---

## 7. 边界与安全

### 7.1 SSRF

`validateUrl` 只校验**入口 URL**：

- 拦截 `localhost`、`127.x`、`10.x`、`192.168.x`、`172.16–31.x`、`0.0.0.0`；
- 不解析 DNS 后再校验，因此域名解析到私有 IP 的情况仍可能绕过；
- 浏览器会跟随重定向、加载图片/脚本/iframe 等子资源，这些请求**不经过** `validateUrl`。

结论：**不要把 `browser` / `auto` 模式直接暴露给不可信用户。** 生产环境应配合容器、网络策略或出站代理做隔离。

### 7.2 执行不受信任的 JS

浏览器模式会执行网页里的 JavaScript。虽然使用临时 profile、抓完即删，但页面代码仍在 Chrome 里运行。建议：

- 在独立容器或低权限用户下运行；
- 不要把宿主机敏感目录挂载给浏览器；
- 保持 Chrome 更新。

### 7.3 反爬不是靠 UA 解决的

- UA、语言头只能改善“普通浏览器”识别；
- 登录墙、验证码、行为检测、IP 风控仍会拦截；
- 头条、知乎实测：普通 HTTP 拿到空壳；浏览器模式能拿到正文；但这不代表对所有站点都有效。

### 7.4 内容提取限制

- iframe 内部内容、Shadow DOM 不一定能进入 `--dump-dom`；
- PDF、图片等非 HTML 内容不会得到有意义的正文；
- 浏览器模式的 `status` 固定为 `200`，无法区分真实的 404/500；
- 正文只保留前 20,000 字符。

### 7.5 性能

- 每次 `browser` 调用都会启动一个 Chrome 进程，没有连接池；
- 典型耗时 5–15 秒，内存占用明显高于 `http`；
- 批量抓取时应控制并发，避免机器被 Chrome 进程打满。

---

## 8. 代码地图

| 关注点 | 位置 |
| --- | --- |
| URL 校验与私网拦截 | [web-fetch.ts L20-L55](web-fetch.ts#L20-L55) |
| 标题提取 | [web-fetch.ts L57-L64](web-fetch.ts#L57-L64) |
| 正文提取与 20k 截断 | [web-fetch.ts L66-L81](web-fetch.ts#L66-L81) |
| HTTP 抓取 | [web-fetch.ts L83-L117](web-fetch.ts#L83-L117) |
| Chrome 路径查找 | [web-fetch.ts L119-L204](web-fetch.ts#L119-L204) |
| Chrome 版本与 UA | [web-fetch.ts L206-L241](web-fetch.ts#L206-L241) |
| Chrome 进程执行 | [web-fetch.ts L243-L283](web-fetch.ts#L243-L283) |
| 残留进程清理 | [web-fetch.ts L285-L304](web-fetch.ts#L285-L304) |
| 浏览器抓取 | [web-fetch.ts L306-L359](web-fetch.ts#L306-L359) |
| `auto` 回退 | [web-fetch.ts L361-L396](web-fetch.ts#L361-L396) |
| 对外入口 | [web-fetch.ts L398-L412](web-fetch.ts#L398-L412) |
| 输入输出类型 | [types.ts](types.ts) |

> 行号会随代码演进变化；找不到时以函数名为准。

---

## 9. 一页总结

```text
默认：auto，先 HTTP，正文为空/过短时回退 browser
纯 HTTP：http，快，不执行 JS，3xx 报错
浏览器：browser，本机 Chrome --headless=new --dump-dom，执行 JS 后提取
自动：auto，http 正文 < 80 字符或报错时回退 browser
配置：CHROME_PATH 指定 Chrome；CHROME_NO_SANDBOX=1 供容器使用
输出：url / status / title / content（≤20k）/ renderMode
安全：入口 URL 有私网校验；浏览器子资源和重定向不受控，不要暴露给不可信用户
限制：反爬、登录墙、iframe/Shadow DOM、非 HTML 内容、单次进程开销
```
