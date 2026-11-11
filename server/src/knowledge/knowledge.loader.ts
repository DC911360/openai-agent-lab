import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { errorMessage } from "../lib/text.js";
import type { KnowledgeChunk, KnowledgeDocument } from "./knowledge.types.js";

const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const MAX_FILE_BYTES = 1_000_000;
const MAX_DEPTH = 5;
const DEFAULT_CHUNK_CHARS = 800;
const DEFAULT_OVERLAP_CHARS = 100;

async function walkFiles(
  directory: string,
  root: string,
  depth: number,
): Promise<string[]> {
  if (depth > MAX_DEPTH) {
    return [];
  }

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    console.warn(
      `[knowledge] 读取目录失败 ${directory}：${errorMessage(error)}`,
    );
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath, root, depth + 1)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      continue;
    }

    const fileStat = await stat(absolutePath);
    if (fileStat.size > MAX_FILE_BYTES) {
      console.warn(`[knowledge] 跳过超过 1MB 的文件：${absolutePath}`);
      continue;
    }

    files.push(absolutePath);
  }

  return files.sort((a, b) =>
    relative(root, a).localeCompare(relative(root, b)),
  );
}

function extractTitle(content: string, source: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }

  const name = basename(source, extname(source)).trim();
  return name || source;
}

/** 从指定目录递归加载 .md/.markdown/.txt 文档。 */
export async function loadKnowledgeDocuments(
  directory: string,
): Promise<KnowledgeDocument[]> {
  const root = resolve(directory);

  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) {
      console.warn(`[knowledge] KNOWLEDGE_DIR 不是目录：${root}`);
      return [];
    }
  } catch {
    console.warn(`[knowledge] KNOWLEDGE_DIR 不存在：${root}`);
    return [];
  }

  const files = await walkFiles(root, root, 0);
  const documents: KnowledgeDocument[] = [];

  for (const file of files) {
    try {
      const content = await readFile(file, "utf8");
      const source = relative(root, file).split(sep).join("/");
      documents.push({
        source,
        title: extractTitle(content, source),
        content,
      });
    } catch (error) {
      console.warn(
        `[knowledge] 读取失败 ${file}：${errorMessage(error)}`,
      );
    }
  }

  return documents;
}

function splitLongParagraph(
  paragraph: string,
  maxChars: number,
  overlapChars: number,
): string[] {
  if (paragraph.length <= maxChars) {
    return [paragraph];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < paragraph.length) {
    let end = Math.min(paragraph.length, start + maxChars);

    if (end < paragraph.length) {
      const candidates = [
        paragraph.lastIndexOf("\n", end),
        paragraph.lastIndexOf("。", end),
        paragraph.lastIndexOf("！", end),
        paragraph.lastIndexOf("？", end),
      ];
      const lastBreak = Math.max(...candidates);
      if (lastBreak > start + maxChars * 0.6) {
        end = lastBreak + 1;
      }
    }

    const chunk = paragraph.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= paragraph.length) {
      break;
    }
    start = Math.max(end - overlapChars, start + 1);
  }

  return chunks;
}

/** 按段落聚合分块，超长段落按句子边界切分并保留少量重叠。 */
export function chunkDocuments(
  documents: KnowledgeDocument[],
  options: { maxChars?: number; overlapChars?: number } = {},
): KnowledgeChunk[] {
  const maxChars = Math.max(200, options.maxChars ?? DEFAULT_CHUNK_CHARS);
  const overlapChars = Math.min(
    Math.max(0, options.overlapChars ?? DEFAULT_OVERLAP_CHARS),
    Math.floor(maxChars / 2),
  );

  const chunks: KnowledgeChunk[] = [];

  for (const document of documents) {
    const paragraphs = document.content
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .flatMap((paragraph) =>
        splitLongParagraph(paragraph, maxChars, overlapChars),
      );

    let current = "";
    let order = 0;

    const flush = () => {
      const content = current.trim();
      current = "";
      if (content.length < 20) {
        return;
      }
      chunks.push({
        id: `${document.source}#${order}`,
        source: document.source,
        title: document.title,
        content,
        order,
      });
      order += 1;
    };

    for (const paragraph of paragraphs) {
      if (!current) {
        current = paragraph;
        continue;
      }

      if (current.length + paragraph.length + 2 <= maxChars) {
        current = `${current}\n\n${paragraph}`;
        continue;
      }

      const overlap = overlapChars > 0 ? current.slice(-overlapChars) : "";
      flush();
      current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
    }

    flush();
  }

  return chunks;
}
