/** 知识库：文档 → 分块 → 检索结果。 */

export type KnowledgeDocument = {
  /** 相对 KNOWLEDGE_DIR 的路径，例如 `guide/context.md` */
  source: string;
  title: string;
  content: string;
};

export type KnowledgeChunk = {
  id: string;
  source: string;
  title: string;
  content: string;
  order: number;
};

export type KnowledgeSearchResult = KnowledgeChunk & {
  score: number;
};
