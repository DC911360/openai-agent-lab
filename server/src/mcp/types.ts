import type OpenAI from "openai";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * 一个已建立的 MCP Server 连接
 */
export interface McpServerConnection {
  /** 配置中的 Server 名称，即 mcpServers 的 key */
  serverName: string;

  /** 已连接的 MCP 客户端 */
  client: Client;

  /** STDIO 传输层，关闭连接时也会用到 */
  transport: StdioClientTransport;

  /** 该 Server 暴露的工具列表 */
  tools: Tool[];
}

/**
 * 注册到工具表中的一项 MCP 工具
 */
export interface McpToolRegisterItem {
  /** 提供给 Model 的工具名称 */
  name: string;

  /** OpenAI Tool Definition */
  definition: OpenAI.Chat.Completions.ChatCompletionTool;

  /** 所属 MCP Server */
  serverName: string;

  /** MCP Server 原始工具名称 */
  mcpToolName: string;

  /** 对应的 MCP Client */
  client: Client;
}
