/**
 * 全页 body 兜底提取器
 * ---------------------------------------------
 * 最后兜底：去掉 script/style/nav/footer 后取 body.textContent。
 * 优先级最低（10），Readability 和语义化都失败才会触发。
 */
import type { ExtractedContent, PageContext } from '@doc-assistant/shared';
import type { ContentExtractor } from '../types';
import { cloneDocument, makeExtractedContent } from './_util';

const NOISE = [
  'script',
  'style',
  'noscript',
  'nav',
  'footer',
  'aside',
  'header',
  'form',
  'iframe',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
];

export const FullBodyExtractor: ContentExtractor = {
  name: 'full-body',
  priority: 10,

  canHandle(ctx: PageContext): boolean {
    return Boolean(ctx.document.body);
  },

  extract(ctx: PageContext): ExtractedContent | null {
    const cloned = cloneDocument(ctx.document);
    const body = cloned.body;
    if (!body) return null;
    for (const sel of NOISE) {
      body.querySelectorAll(sel).forEach((el) => el.remove());
    }
    const text = (body.textContent ?? '').trim();
    if (text.length < 40) return null;
    return makeExtractedContent({
      title: ctx.title || '',
      content: text,
      extractor: 'full-body',
    });
  },
};
