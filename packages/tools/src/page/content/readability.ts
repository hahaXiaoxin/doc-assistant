/**
 * Readability 内容提取器
 * ---------------------------------------------
 * 使用 @mozilla/readability（Firefox Reader View 同款）。
 * 对博客/文档/新闻类页面覆盖率极高，优先级最高（80，但低于 Selection 的 90）。
 *
 * 关键点：
 * - Readability 会修改 DOM，所以必须先 clone 再解析，避免污染宿主页
 * - 最低字符阈值：Readability 返回内容小于 120 字视为失败
 */
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import type { ExtractedContent, PageContext } from '@doc-assistant/shared';
import { createLogger } from '@doc-assistant/shared';
import type { ContentExtractor } from '../types';
import { cloneDocument, makeExtractedContent } from './_util';

const logger = createLogger('tools:content:readability');

const MIN_CHARS = 120;

export const ReadabilityExtractor: ContentExtractor = {
  name: 'readability',
  priority: 80,

  canHandle(ctx: PageContext): boolean {
    // isProbablyReaderable 内部需要 document；happy-dom 兼容
    try {
      return isProbablyReaderable(ctx.document);
    } catch (err) {
      logger.debug('isProbablyReaderable 失败，仍然尝试解析:', (err as Error).message);
      return true;
    }
  },

  extract(ctx: PageContext): ExtractedContent | null {
    const cloned = cloneDocument(ctx.document);
    try {
      const reader = new Readability(cloned);
      const parsed = reader.parse();
      if (!parsed) return null;
      const content = (parsed.textContent ?? '').trim();
      if (content.length < MIN_CHARS) {
        logger.debug('Readability 返回内容过短，放弃:', content.length);
        return null;
      }
      return makeExtractedContent({
        title: parsed.title?.trim() || ctx.title,
        content,
        extractor: 'readability',
      });
    } catch (err) {
      logger.warn('Readability 解析异常:', (err as Error).message);
      return null;
    }
  },
};
