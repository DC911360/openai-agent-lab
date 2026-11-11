import type { AgentToolCall, AgentToolResult } from "./agent.types.js";

export type ToolContext = {
  signal?: AbortSignal;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<unknown> | unknown;

export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema，未来可直接传给模型的 tools 参数 */
  parameters: Record<string, unknown>;
  timeoutMs?: number;
  handler: ToolHandler;
};

const DEFAULT_TOOL_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`工具执行超时（${timeoutMs}ms）`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 工具注册表：Agent 循环通过它发现与执行工具。 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具已注册：${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  async execute(
    call: AgentToolCall,
    context: ToolContext = {},
  ): Promise<AgentToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        callId: call.id,
        ok: false,
        content: `未知工具：${call.name}`,
      };
    }

    try {
      const output = await withTimeout(
        Promise.resolve(tool.handler(call.arguments, context)),
        tool.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
      );

      return {
        callId: call.id,
        ok: true,
        content:
          typeof output === "string" ? output : JSON.stringify(output),
      };
    } catch (error) {
      return {
        callId: call.id,
        ok: false,
        content: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const toolRegistry = new ToolRegistry();
