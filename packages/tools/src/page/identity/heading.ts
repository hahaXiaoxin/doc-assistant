/**
 * 标题+路径 识别策略（fallback）
 * ---------------------------------------------
 * 取第一个 <h1>（或 document.title）+ URL pathname 组装身份。
 * 最后一个有信号的策略，优先级较低。
 */
import type { ArticleIdentity, PageContext } from '@doc-assistant/shared';
import type { IdentityStrategy } from '../types';

export const HeadingStrategy: IdentityStrategy = {
  name: 'heading',
  priority: 30,

  extract(ctx: PageContext): ArticleIdentity | null {
    const h1 = ctx.document.querySelector<HTMLElement>('h1');
    const title = h1?.textContent?.trim() ?? ctx.title.trim();
    if (!title) return null;
    try {
      const u = new URL(ctx.url);
      return {
        id: `heading:${u.hostname}${u.pathname}`,
        title,
        url: ctx.url,
        source: 'heading',
      };
    } catch {
      return null;
    }
  },
};
