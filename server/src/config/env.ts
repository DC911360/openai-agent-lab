import "dotenv/config";

export type ContextStrategyEnv = "full" | "window" | "summary-window";

function readRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value === "xxxx") {
    throw new Error(`请检查 server/.env 文件中的 ${name}`);
  }
  return value;
}

function readPort(): number {
  return readInt("PORT", 3001, 1, 65535);
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 之间的整数，当前值：${raw}`);
  }
  return value;
}

function readFloat(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 之间的数字，当前值：${raw}`);
  }
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  throw new Error(`${name} 必须是 true/false，当前值：${raw}`);
}

/**
 * 流式 chunk 落盘开关：
 * - 不设置 / false / 0 / no / off → 关闭
 * - true / 1 / yes / on → 写入默认路径 logs/stream-chunks.jsonl
 * - 其他值 → 当作自定义文件路径
 */
function readStreamChunkLogFile(): string | null {
  const raw = process.env.STREAM_CHUNK_LOG?.trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return "logs/stream-chunks.jsonl";
  }
  return raw;
}

function readEnum<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  if (!allowed.includes(raw as T)) {
    throw new Error(`${name} 必须是 ${allowed.join(" / ")} 之一，当前值：${raw}`);
  }
  return raw as T;
}

const strategy = readEnum<ContextStrategyEnv>(
  "CONTEXT_STRATEGY",
  ["full", "window", "summary-window"],
  "window",
);

export const env = {
  deepseekApiKey: readRequired("DEEPSEEK_API_KEY"),
  deepseekBaseURL: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
  deepseekTimeoutMs: readInt("DEEPSEEK_TIMEOUT_MS", 120_000, 1000, 600_000),
  deepseekMaxRetries: readInt("DEEPSEEK_MAX_RETRIES", 1, 0, 5),
  port: readPort(),
  corsOrigin: process.env.CORS_ORIGIN?.trim() || "http://localhost:5173",

  /** 流式 chunk 调试落盘：null 表示关闭，非空为输出文件路径 */
  streamChunkLogFile: readStreamChunkLogFile(),

  /** 为空时使用 context/context.policy.ts 中的默认 system prompt */
  contextSystemPrompt: process.env.CONTEXT_SYSTEM_PROMPT?.trim() || "",

  context: {
    strategy,
    maxTokens: readInt("CONTEXT_MAX_TOKENS", 8000, 512, 200_000),
    maxHistoryMessages: readInt("CONTEXT_MAX_MESSAGES", 20, 0, 200),
    reserveOutputTokens: readInt("CONTEXT_RESERVE_OUTPUT", 1024, 0, 32_000),
    summaryThreshold: readFloat("CONTEXT_SUMMARY_THRESHOLD", 0.6, 0.1, 1),
    summaryKeepTurns: readInt("CONTEXT_SUMMARY_KEEP_TURNS", 4, 0, 50),
    summaryMaxTokens: readInt("CONTEXT_SUMMARY_MAX_TOKENS", 800, 100, 4000),

    memoryEnabled: readBoolean("MEMORY_ENABLED", false),
    memoryLimit: readInt("MEMORY_LIMIT", 5, 1, 50),
    memoryBudgetRatio: readFloat("MEMORY_BUDGET_RATIO", 0.15, 0, 0.5),

    knowledgeDir: process.env.KNOWLEDGE_DIR?.trim() || "",
    knowledgeTopK: readInt("KNOWLEDGE_TOP_K", 4, 1, 20),
    knowledgeBudgetRatio: readFloat("KNOWLEDGE_BUDGET_RATIO", 0.25, 0, 0.5),
  },
} as const;
