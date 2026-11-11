/**
 * 会话级并发控制：同一会话同一时刻只允许一个生成请求。
 * 返回 409 比排队更适合当前的内存版实现。
 */
const lockedConversations = new Set<string>();

export function tryAcquireConversationLock(conversationId: string): boolean {
  if (lockedConversations.has(conversationId)) {
    return false;
  }
  lockedConversations.add(conversationId);
  return true;
}

export function releaseConversationLock(conversationId: string): void {
  lockedConversations.delete(conversationId);
}

export function isConversationLocked(conversationId: string): boolean {
  return lockedConversations.has(conversationId);
}
