import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toOpenAITools } from "./mcp-adapter.js";
import type { McpServerConnection, McpToolRegisterItem } from "./types.js";

const toolRegistry = new Map<string, McpToolRegisterItem>();

export function registerMCPTools(connections: McpServerConnection[]) {
  for (const connection of connections) {
    const { client, tools, serverName } = connection;
    const definitions = toOpenAITools(tools);

    for (let i = 0; i < tools.length; i++) {
      const mcpTool = tools[i];
      const definition = definitions[i];

      toolRegistry.set(mcpTool.name, {
        name: mcpTool.name,
        definition,
        serverName,
        mcpToolName: mcpTool.name,
        client,
      });
    }
  }
}


/**
 * 获取全部 OpenAI Tool Definition
 */
export function getDefinitions() {
  return Array.from(toolRegistry.values()).map(
    (item) => item.definition,
  );
}

/**
 * 根据工具名称获取 Definition
 */
export function getDefinition(name: string) {
  return toolRegistry.get(name)?.definition;
}

/**
 * 根据工具名称执行 MCP Tool
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const item = toolRegistry.get(name);

  if (!item) {
    throw new Error(`MCP Tool 不存在: ${name}`);
  }

  // callTool 的返回是联合类型（含兼容旧版的 toolResult 分支），
  // 实际按标准 CallToolResult 使用
  return (await item.client.callTool({
    name: item.mcpToolName,
    arguments: args,
  })) as CallToolResult;
}

