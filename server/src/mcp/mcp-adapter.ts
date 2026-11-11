
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import type OpenAI from "openai";

/**
 * MCP Tool 转换成 OpenAI Function Tool
 */
export function toOpenAITool(
  tool: McpTool,
): OpenAI.Chat.Completions.ChatCompletionTool {
  // MCP 的 inputSchema 就是工具的参数 JSON Schema
  const { $schema, ...parameters } = tool.inputSchema as Record<
    string,
    unknown
  >;

  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters,
    },
  } as OpenAI.Chat.Completions.ChatCompletionTool;
}

/**
 * 批量转换 MCP Tools
 */
export function toOpenAITools(
  tools: McpTool[],
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map(toOpenAITool);
}
