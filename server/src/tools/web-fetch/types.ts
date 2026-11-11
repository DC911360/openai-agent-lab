/**
 * Web Fetch 工具的输入参数
 */

/** 抓取方式：直接 HTTP、浏览器渲染，或先 HTTP 失败后自动回退浏览器。 */
export type WebFetchRenderMode = "http" | "browser" | "auto";

export interface WebFetchInput {
  /** 需要读取的网页地址 */
  url: string;

  /**
   * 抓取方式，默认 `"auto"`：
   * - `http`：直接请求并解析原始 HTML，速度快，但不执行 JS；
   * - `browser`：用无头 Chrome 执行页面 JS，再解析渲染后的 DOM；
   * - `auto`：先走 `http`，正文为空或过短时自动回退到 `browser`。
   */
  render?: WebFetchRenderMode;
}

/**
 * Web Fetch 工具的执行结果
 */
export interface WebFetchResult {
  /** 请求的网页地址 */
  url: string;

  /** HTTP 状态码，例如 200、404；浏览器模式固定为 200 */
  status: number;

  /** 网页标题 */
  title?: string;

  /** 提取后的网页文本 */
  content: string;

  /** 实际使用的抓取方式 */
  renderMode: "http" | "browser";
}
