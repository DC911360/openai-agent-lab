import { knowledgeStore } from "./knowledge.store.js";
import type { KnowledgeSearchResult } from "./knowledge.types.js";

/** 检索入口：隔离「索引实现」与「上层使用方式」。 */
export function retrieveKnowledge(
  query: string,
  topK: number,
): KnowledgeSearchResult[] {
  return knowledgeStore.search(query, topK);
}
