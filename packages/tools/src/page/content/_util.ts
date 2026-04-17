/**
 * 提取器共享工具
 */
import type { ExtractedContent } from '@doc-assistant/shared';

/** 粗略生成摘要：取纯文本前 200 字 */
export function buildExcerpt(content: string, limit = 200): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

export function makeExtractedContent(args: {
  title: string;
  content: string;
  extractor: string;
}): ExtractedContent {
  const trimmed = args.content.replace(/\s+/g, ' ').trim();
  return {
    title: args.title.trim(),
    content: trimmed,
    excerpt: buildExcerpt(trimmed),
    charCount: trimmed.length,
    extractor: args.extractor,
  };
}

/**
 * 拷贝 document 以避免污染宿主页（Readability 会修改 DOM）
 */
export function cloneDocument(doc: Document): Document {
  const cloned = doc.cloneNode(true) as Document;
  return cloned;
}
