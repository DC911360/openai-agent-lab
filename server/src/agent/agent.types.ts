/**
 * Agent 运行时类型（后续扩展）：
 * 为工具调用循环、任务状态、执行终止条件预留统一模型。
 */

export type AgentTerminationReason =
  | "completed"
  | "max-steps"
  | "timeout"
  | "aborted"
  | "error";

export type AgentToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AgentToolResult = {
  callId: string;
  ok: boolean;
  content: string;
};

export type AgentStep =
  | { type: "thought"; content: string }
  | { type: "tool"; call: AgentToolCall }
  | { type: "observation"; result: AgentToolResult }
  | { type: "final"; content: string }
  | { type: "error"; message: string };

export type AgentState = {
  task: string;
  steps: AgentStep[];
  stepCount: number;
  startedAt: number;
};

export type AgentRunResult = {
  task: string;
  steps: AgentStep[];
  termination: AgentTerminationReason;
  finalContent?: string;
  error?: string;
  durationMs: number;
};

export type AgentExecutor = (
  state: AgentState,
) => Promise<AgentStep> | AgentStep;

export type AgentLoopOptions = {
  maxSteps?: number;
  timeoutMs?: number;
};
