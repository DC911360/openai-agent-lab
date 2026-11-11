const activeRequests = new Map<string, AbortController>();

/**
 * 登记进行中的请求。
 * 返回 false 表示同一 requestId 已存在，调用方应拒绝本次请求。
 */
export function registerActiveRequest(
  requestId: string,
  controller: AbortController,
): boolean {
  if (activeRequests.has(requestId)) {
    return false;
  }
  activeRequests.set(requestId, controller);
  return true;
}

export function unregisterActiveRequest(requestId: string): void {
  activeRequests.delete(requestId);
}

/**
 * 中断指定请求。
 * 返回 false 表示该 requestId 不存在或已经结束。
 */
export function abortActiveRequest(requestId: string): boolean {
  const controller = activeRequests.get(requestId);
  if (!controller) {
    return false;
  }
  controller.abort("api");
  return true;
}

export function activeRequestCount(): number {
  return activeRequests.size;
}
