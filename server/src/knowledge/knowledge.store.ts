import { tokenize } from "../lib/text.js";
import type { KnowledgeChunk, KnowledgeSearchResult } from "./knowledge.types.js";

type IndexedChunk = KnowledgeChunk & {
  termFrequencies: Map<string, number>;
  length: number;
};

const BM25_K1 = 1.5;
const BM25_B = 0.75;

/**
 * 内存知识索引 + BM25 检索。
 * 对中文使用二元组分词，对英文使用单词；未来可替换为向量检索。
 */
export class InMemoryKnowledgeStore {
  private chunks: IndexedChunk[] = [];
  private documentFrequencies = new Map<string, number>();
  private averageLength = 0;

  setChunks(chunks: KnowledgeChunk[]): void {
    this.chunks = chunks.map((chunk) => {
      const tokens = tokenize(chunk.content);
      const termFrequencies = new Map<string, number>();

      for (const token of tokens) {
        termFrequencies.set(token, (termFrequencies.get(token) ?? 0) + 1);
      }

      return {
        ...chunk,
        termFrequencies,
        length: tokens.length,
      };
    });

    this.documentFrequencies = new Map();
    for (const chunk of this.chunks) {
      for (const token of chunk.termFrequencies.keys()) {
        this.documentFrequencies.set(
          token,
          (this.documentFrequencies.get(token) ?? 0) + 1,
        );
      }
    }

    this.averageLength =
      this.chunks.length > 0
        ? this.chunks.reduce((total, chunk) => total + chunk.length, 0) /
          this.chunks.length
        : 0;
  }

  search(query: string, topK: number): KnowledgeSearchResult[] {
    if (topK <= 0 || this.chunks.length === 0) {
      return [];
    }

    const queryTokens = [...new Set(tokenize(query))];
    if (queryTokens.length === 0) {
      return [];
    }

    const totalChunks = this.chunks.length;
    const averageLength = this.averageLength || 1;

    return this.chunks
      .map((chunk) => {
        let score = 0;

        for (const token of queryTokens) {
          const frequency = chunk.termFrequencies.get(token);
          if (!frequency) {
            continue;
          }

          const documentFrequency =
            this.documentFrequencies.get(token) ?? 0;
          const idf = Math.log(
            1 + (totalChunks - documentFrequency + 0.5) / (documentFrequency + 0.5),
          );
          const denominator =
            frequency +
            BM25_K1 * (1 - BM25_B + BM25_B * (chunk.length / averageLength));

          score += idf * ((frequency * (BM25_K1 + 1)) / denominator);
        }

        return { chunk, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ chunk, score }) => ({
        id: chunk.id,
        source: chunk.source,
        title: chunk.title,
        content: chunk.content,
        order: chunk.order,
        score,
      }));
  }

  get size(): number {
    return this.chunks.length;
  }

  clear(): void {
    this.chunks = [];
    this.documentFrequencies.clear();
    this.averageLength = 0;
  }
}

export const knowledgeStore = new InMemoryKnowledgeStore();
