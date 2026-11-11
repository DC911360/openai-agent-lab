import type { ChatTrace } from "../types/chat";

const TRACE_ENDPOINT = "/api/logs/traces";

/** 按 requestId 拉取服务端记录的 user → agent → model 轨迹 */
export async function getChatTrace(requestId: string): Promise<ChatTrace> {
  const response = await fetch(
    `${TRACE_ENDPOINT}/${encodeURIComponent(requestId)}`,
  );

  if (!response.ok) {
    let message = `加载轨迹失败（HTTP ${response.status}）`;

    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) {
        message = data.error;
      }
    } catch {
      // 非 JSON 响应，保留状态码提示
    }

    throw new Error(message);
  }

  return (await response.json()) as ChatTrace;
}
