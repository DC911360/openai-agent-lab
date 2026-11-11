
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import {
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

import type { McpServerConfig } from "./mcp-config.js";
import type { McpServerConnection } from "./types.js";

/**
 * 根据配置连接一个 MCP Server
 */
export async function connectMcpServer(
  serverName: string,
  config: McpServerConfig,
): Promise<McpServerConnection> {
  // 1. 继承当前 Node.js 环境变量
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string",
    ),
  );

  // 2. 合并 MCP Server 独立配置的环境变量
  Object.assign(env, config.env ?? {});

  // 3. 创建 STDIO Transport
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env,
    cwd: config.cwd,
  });

  // 4. 创建 MCP Client
  const client = new Client({
    name: `openai-agent-lab-${serverName}`,
    version: "1.0.0",
  });

  try {
    // 5. 建立连接
    await client.connect(transport);

    // 6. 发现工具
    const result = await client.listTools();
    console.log(`[MCP] ${serverName} 连接成功`);
    console.log(`[MCP] 发现 ${result.tools.length} 个工具`);

    return {
      serverName,
      client,
      transport,
      tools: result.tools,
    };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}
