import type {
  AgentExecutor,
  AgentLoopOptions,
  AgentRunResult,
  AgentState,
  AgentStep,
} from "./agent.types.js";

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 通用 Agent 循环骨架。
 *
 * 当前只负责：步数、超时、中断、终止原因与步骤轨迹。
 * 后续接入模型 tool_calls 时，由 executor 负责：
 *   1. 调用 ai/chat.ts；
 *   2. 解析 tool_calls；
 *   3. 通过 agent.registry.ts 执行工具并追加 observation；
 *   4. 满足终止条件时返回 final / error。
 */
export class AgentLoop {
  constructor(
    private readonly executor: AgentExecutor,
    private readonly options: AgentLoopOptions = {},
  ) {}

  async run(task: string, signal?: AbortSignal): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const maxSteps = this.options.maxSteps ?? DEFAULT_MAX_STEPS;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const state: AgentState = {
      task,
      steps: [],
      stepCount: 0,
      startedAt,
    };

    let termination: AgentRunResult["termination"] = "max-steps";
    let finalContent: string | undefined;
    let error: string | undefined;

    while (state.stepCount < maxSteps) {
      if (signal?.aborted) {
        termination = "aborted";
        break;
      }

      if (Date.now() - startedAt > timeoutMs) {
        termination = "timeout";
        break;
      }

      let step: AgentStep;
      try {
        step = await this.executor(state);
      } catch (caught) {
        step = {
          type: "error",
          message: caught instanceof Error ? caught.message : String(caught),
        };
      }

      state.steps.push(step);
      state.stepCount += 1;

      if (step.type === "final") {
        termination = "completed";
        finalContent = step.content;
        break;
      }

      if (step.type === "error") {
        termination = "error";
        error = step.message;
        break;
      }

      // thought / tool / observation：继续下一步
    }

    return {
      task,
      steps: state.steps,
      termination,
      finalContent,
      error,
      durationMs: Date.now() - startedAt,
    };
  }
}
