import { env } from "../config/env.js";
import type { ContextKnowledgeChunk } from "../context/context.types.js";
import { errorMessage } from "../lib/text.js";
import { chunkDocuments, loadKnowledgeDocuments } from "./knowledge.loader.js";
import { retrieveKnowledge } from "./knowledge.retriever.js";
import { knowledgeStore } from "./knowledge.store.js";

let initialization: Promise<void> | null = null;

async function initialize(): Promise<void> {
  const directory = env.context.knowledgeDir;

  if (!directory) {
    console.log("[knowledge] 未配置 KNOWLEDGE_DIR，知识库为空");
    return;
  }

  try {
    const documents = await loadKnowledgeDocuments(directory);
    const chunks = chunkDocuments(documents);
    knowledgeStore.setChunks(chunks);
    console.log(
      `[knowledge] 已加载 ${documents.length} 个文档，${chunks.length} 个分块`,
    );
  } catch (error) {
    console.warn(
      `[knowledge] 知识库加载失败，将以空知识库运行：${errorMessage(error)}`,
    );
  }
}

/** 幂等初始化；服务启动时调用一次，检索时也会自动兜底。 */
export function initializeKnowledge(): Promise<void> {
  initialization ??= initialize();
  return initialization;
}

export async function searchKnowledge(
  query: string,
  topK: number,
): Promise<ContextKnowledgeChunk[]> {
  await initializeKnowledge();

  if (knowledgeStore.size === 0 || !query.trim()) {
    return [];
  }

  return retrieveKnowledge(query, topK).map((result) => ({
    id: result.id,
    source: result.source,
    title: result.title,
    content: result.content,
    score: result.score,
  }));
}

export function knowledgeChunkCount(): number {
  return knowledgeStore.size;
}
