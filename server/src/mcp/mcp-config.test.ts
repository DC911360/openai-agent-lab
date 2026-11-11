import "dotenv/config";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { loadMcpConfig } from "./mcp-config.js";
import { connectMcpServer } from "./mcp-client.js";
import type { McpServerConnection } from "./types.js";
import { toOpenAITools } from "./mcp-adapter.js";
import {
  registerMCPTools,
  getDefinitions,
  getDefinition,
  executeTool,
} from "./mcp-manager.js";

/** 取出 MCP Tool 返回中的所有 text 内容 */
function toText(result: CallToolResult): string {
  return result.content
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .join("\n");
}

async function main() {
  const connections: McpServerConnection[] = [];

  try {
    // 1. 读取 mcp.json
    const config = await loadMcpConfig();

    console.log("读取 MCP 配置成功");
    console.log("发现 MCP Server：", Object.keys(config.mcpServers));

    // 2. 遍历配置，逐个启动 MCP Server
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      const connection = await connectMcpServer(name, serverConfig);

      connections.push(connection);
    }

    registerMCPTools(connections);

    // 1. 获取全部工具定义
    const definitions = getDefinitions();

    console.log("工具数量：", definitions.length);

    // 2. 查询单个工具定义
    const definition = getDefinition("lanhu_get_design_document");

    console.log("单个工具定义：", definition);

    // 3. 从蓝湖 URL 设置默认项目（自动提取 projectId）
    const LANHU_PROJECT_URL =
      "https://lanhuapp.com/web/#/item/project/detailDetach?tid=ba722a59-4856-4b06-adcd-5584f7b57356&pid=c4b932d7-f3ce-4933-a08c-c4821ff50c69&project_id=c4b932d7-f3ce-4933-a08c-c4821ff50c69&image_id=ce09c55a-7943-4e99-8f1b-7c2e90a5cf76&fromEditor=true&type=image";
    const PROJECT_ID = "c4b932d7-f3ce-4933-a08c-c4821ff50c69";
    const IMAGE_ID = "ce09c55a-7943-4e99-8f1b-7c2e90a5cf76";

    const setProject = await executeTool("lanhu_set_project", {
      url: LANHU_PROJECT_URL,
    });
    console.log("set_project=>", toText(setProject));

    // 4. 项目下的设计稿列表
    const designs = await executeTool("lanhu_get_designs", {
      projectId: PROJECT_ID,
    });
    console.log("designs=>", toText(designs));

    // 5. 设计稿结构化数据（layer 树 + 样式）
    const doc = await executeTool("lanhu_get_design_document", {
      imageId: IMAGE_ID,
      projectId: PROJECT_ID,
      depth: 2,
    });
    console.log("design_document=>");
    console.log(toText(doc));

    // console.log("connections=>",connections);
    // console.log(JSON.stringify(connections[0].tools, null, 2));

    // 将所有 MCP Tools 转换为 OpenAI Tools
    // const openAITools = connections.flatMap(({ tools }) =>
    //   toOpenAITools(tools),
    // );

    // console.log("OpenAI Tools 数量：", openAITools.length);

    // console.log("openAITools=> 工具",JSON.stringify(openAITools, null, 2));
  } catch (error) {
    console.error("MCP 加载失败：", error);
    process.exitCode = 1;
  } finally {
    // 3. 关闭所有连接
    await Promise.all(connections.map(({ client }) => client.close()));
  }
}

main();
