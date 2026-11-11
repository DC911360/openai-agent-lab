import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { initializeKnowledge } from "./knowledge/knowledge.service.js";
import { initializeTools } from "./tools/initialize.js";
import { initializeMcp, closeMcp } from "./mcp/mcp-loader.js";


async function main(): Promise<void> {
  await initializeKnowledge();

  // 2. 发现并注册工具
  await initializeTools();
  
  // 初始化 MCP Servers
  await initializeMcp();

  const app = createApp();

  const server = app.listen(env.port, () => {
    console.log(`API server 已启动：http://localhost:${env.port}`);
    console.log(`健康检查：http://localhost:${env.port}/api/health`);
    console.log(`上下文策略：${env.context.strategy}`);
  });

  function shutdown(signal: string): void {
    console.log(`\n收到 ${signal}，正在关闭服务...`);
    server.close(async () => {
      await closeMcp();
      process.exit(0);
    });

    // 兜底：连接迟迟不关闭时强制退出
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main().catch((error) => {
  console.error("服务启动失败：", error);
  process.exit(1);
});
