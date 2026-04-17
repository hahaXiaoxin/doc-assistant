/**
 * 用户选区提取器
 * ---------------------------------------------
 * 仅在用户当前选中了文本时激活（canHandle 检查 ctx.selectionText 非空）。
 * 优先级 90，高于 Readability，让"用户手动选中后提问"始终以选区为上下文。
 */
import type { ExtractedContent, PageContext } from '@doc-assistant/shared';
import type { ContentExtractor } from '../types';
import { makeExtractedContent } from './_util';

export const SelectionExtractor: ContentExtractor = {
  name: 'selection',
  priority: 90,

  canHandle(ctx: PageContext): boolean {
    return Boolean(ctx.selectionText && ctx.selectionText.trim().length > 0);
  },

  extract(ctx: PageContext): ExtractedContent | null {
    const text = ctx.selectionText?.trim() ?? '';
    if (!text) return null;
    return makeExtractedContent({
      title: ctx.title || '用户选中文本',
      content: text,
      extractor: 'selection',
    });
  },
};
