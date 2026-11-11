
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * MCP Server 配置类型
 */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * MCP 总配置类型
 */
export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

// 当前文件所在目录：server/src/mcp
const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

// server 根目录
const SERVER_ROOT = resolve(CURRENT_DIR, "../..");

// MCP 配置文件路径
const MCP_CONFIG_PATH = resolve(SERVER_ROOT, "mcp.json");

/**
 * 加载 MCP 配置
 */
export async function loadMcpConfig(): Promise<McpConfig> {
  const content = await readFile(MCP_CONFIG_PATH, "utf-8");

  const config = JSON.parse(content) as McpConfig;
  console.log("config=>",config)

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    throw new Error("MCP 配置错误：缺少 mcpServers");
  }

  return config;
}
