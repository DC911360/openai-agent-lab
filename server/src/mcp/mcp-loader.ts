import { loadMcpConfig } from "./mcp-config.js";
import { connectMcpServer } from "./mcp-client.js";
import { registerMCPTools } from "./mcp-manager.js";
import type { McpServerConnection } from "./types.js";

/** 当前已建立的 MCP 连接，进程退出时统一关闭 */
let connections: McpServerConnection[] = [];

/**
 * 读取 mcp.json，连接所有 MCP Server 并把工具注册到工具表
 *
 * 注意：连接会一直保持，不能在这里关闭，否则注册的工具无法再调用。
 * 关闭动作由 closeMcp() 在服务退出时执行。
 */
export async function initializeMcp(): Promise<void> {
  const config = await loadMcpConfig();

  console.log("读取 MCP 配置成功");
  console.log("发现 MCP Server：", Object.keys(config.mcpServers));

  try {
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      const connection = await connectMcpServer(name, serverConfig);

      connections.push(connection);
    }

    registerMCPTools(connections);
  } catch (error) {
    // 启动失败时回收已建立的连接，避免残留子进程
    await closeMcp();
    throw error;
  }
}

/**
 * 关闭所有 MCP Server 连接
 */
export async function closeMcp(): Promise<void> {
  const closing = connections;
  connections = [];

  await Promise.allSettled(closing.map(({ client }) => client.close()));
}
