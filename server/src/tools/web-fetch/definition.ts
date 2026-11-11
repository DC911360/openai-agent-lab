
import type { ToolDefinition } from "../too.type.js";
export const webFetchDefinition:ToolDefinition = {
  type: "function",
  function: {
    name: "web_fetch",
    description:
      "读取指定 URL 的网页内容，返回网页标题和正文。默认会自动处理需要 JS 渲染或带反爬壳的页面（如头条、知乎）。",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "需要读取的网页 URL",
        },
        render: {
          type: "string",
          enum: ["auto", "http", "browser"],
          description:
            "抓取方式，默认 auto。auto：先 HTTP，正文为空或过短时自动用无头 Chrome 渲染；http：只请求原始 HTML，速度快但拿不到 JS 渲染内容；browser：直接用无头 Chrome 渲染。",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
} as const;