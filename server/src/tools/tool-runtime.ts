import type OpenAI from "openai";

import { getToolDefinitions,getTool } from './registry.js'

import { getDefinitions,getDefinition,executeTool as executeMcpTool } from  '../mcp/mcp-manager.js'


/**
 * 获取所有工具定义
 *
 * Local Tool + MCP Tool
 * 最终统一转换为 OpenAI Function Tool Definition
 */
export function getAllToolDefinitions():
  OpenAI.Chat.Completions.ChatCompletionTool[] {

  const localDefinitions =
    getToolDefinitions() as OpenAI.Chat.Completions.ChatCompletionTool[];

  const mcpDefinitions = getDefinitions();

  // 检查 Local Tool 和 MCP Tool 是否重名
  const names = new Set<string>();

  for (const definition of [...localDefinitions, ...mcpDefinitions]) {
    if (definition.type !== "function") continue;

    const name = definition.function.name;

    if (names.has(name)) {
      throw new Error(`Tool 名称冲突: ${name}`);
    }

    names.add(name);
  }

  return [...localDefinitions, ...mcpDefinitions];
}

/**
 * 统一执行工具
 *
 * 根据工具名称判断执行路径：
 * 1. Local Tool -> 本地 execute()
 * 2. MCP Tool   -> MCP Client.callTool()
 */

export async function executeUnifiedTool(
  toolCall: {
    function: {
      name: string;
      arguments: string;
    };
  },
): Promise<string> {
  const { name, arguments: rawArguments } = toolCall.function;

  try {
    // 解析模型传入的 JSON 参数
    const args: unknown = JSON.parse(rawArguments);

    if (
      args === null ||
      typeof args !== "object" ||
      Array.isArray(args)
    ) {
      throw new Error("工具参数必须是 JSON 对象");
    }

    // 第一条执行路径：Local Tool
    const localTool = getTool(name);

    if (localTool) {
      const result = await localTool.execute(args);

      return typeof result === "string"
        ? result
        : JSON.stringify(result);
    }

    // 第二条执行路径：MCP Tool
    if (getDefinition(name)) {
      const result = await executeMcpTool(
        name,
        args as Record<string, unknown>,
      );

      // MCP 执行失败，也将错误信息返回给 Model
      if (result.isError) {
        return JSON.stringify({
          isError: true,
          content: result.content,
          structuredContent: result.structuredContent,
        });
      }

      // 优先使用结构化结果
      if (result.structuredContent !== undefined) {
        return JSON.stringify(result.structuredContent);
      }

      // 普通文本结果
      const textContent = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text);

      if (textContent.length > 0) {
        return textContent.join("\n");
      }

      // 其他类型的 MCP 内容，保留原始结构
      return JSON.stringify(result.content);
    }

    throw new Error(`工具不存在: ${name}`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    console.error(`[Tool Runtime] ${name} 执行失败:`, message);

    // 不直接中断 Agent 循环，让 Model 有机会理解错误并作出回应
    return JSON.stringify({
      isError: true,
      tool: name,
      error: message,
    });
  }
}