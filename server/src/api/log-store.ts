import type { RequestLog } from "./log.types.js";

const MAX_LOGS = 200;

// 进程内存储：服务重启即清空
const logs: RequestLog[] = [];

export function addLog(entry: RequestLog): void {
  logs.push(entry);

  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
}

export type GetLogsOptions = {
  limit?: number;
  requestId?: string;
};

/** 返回最近的日志，新的在前 */
export function getLogs(options: GetLogsOptions = {}): RequestLog[] {
  const { limit = 50, requestId } = options;

  const filtered = requestId
    ? logs.filter((entry) => entry.requestId === requestId)
    : logs;

  return filtered.slice(-limit).reverse();
}

export function logCount(): number {
  return logs.length;
}
