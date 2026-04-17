/**
 * 语义化标签提取器
 * ---------------------------------------------
 * 依次尝试：<article> → <main> → [role="main"] → 最大 section。
 * 剔除 nav/footer/aside/script/style/<noscript>/<form>，保留文本。
 * 作为 Readability 失败时的兜底，覆盖那些语义化但不是典型"文章"的页面。
 */
import type { ExtractedContent, PageContext } from '@doc-assistant/shared';
import type { ContentExtractor } from '../types';
import { cloneDocument, makeExtractedContent } from './_util';

const EXCLUDE_SELECTORS = [
  'nav',
  'footer',
  'aside',
  'script',
  'style',
  'noscript',
  'form',
  'header nav',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
];

function pickRoot(doc: Document): HTMLElement | null {
  return (
    doc.querySelector<HTMLElement>('article') ??
    doc.querySelector<HTMLElement>('main') ??
    doc.querySelector<HTMLElement>('[role="main"]') ??
    doc.querySelector<HTMLElement>('section')
  );
}

function stripNoise(root: HTMLElement): void {
  for (const sel of EXCLUDE_SELECTORS) {
    root.querySelectorAll(sel).forEach((el) => el.remove());
  }
}

export const SemanticTagExtractor: ContentExtractor = {
  name: 'semantic',
  priority: 60,

  canHandle(ctx: PageContext): boolean {
    return Boolean(pickRoot(ctx.document));
  },

  extract(ctx: PageContext): ExtractedContent | null {
    const cloned = cloneDocument(ctx.document);
    const root = pickRoot(cloned);
    if (!root) return null;
    stripNoise(root);
    const text = (root.textContent ?? '').trim();
    if (text.length < 80) return null;
    const title =
      root.querySelector<HTMLElement>('h1')?.textContent?.trim() ||
      ctx.title.trim() ||
      '';
    return makeExtractedContent({
      title,
      content: text,
      extractor: 'semantic',
    });
  },
};
