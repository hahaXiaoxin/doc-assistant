/**
 * URL 兜底策略
 * ---------------------------------------------
 * 所有其他策略失败时使用；仅基于归一化 URL 生成身份。
 * 归一化：去 fragment、按字母顺序排序 query 参数。
 */
import type { ArticleIdentity, PageContext } from '@doc-assistant/shared';
import type { IdentityStrategy } from '../types';

function normalizeUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    u.hash = '';
    // 稳定的 query 排序
    const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    const search = new URLSearchParams(params).toString();
    return `${u.origin}${u.pathname}${search ? '?' + search : ''}`;
  } catch {
    return urlStr;
  }
}

export const UrlFallbackStrategy: IdentityStrategy = {
  name: 'url-fallback',
  priority: 10,

  extract(ctx: PageContext): ArticleIdentity | null {
    const normalized = normalizeUrl(ctx.url);
    return {
      id: `url:${normalized}`,
      title: ctx.title || normalized,
      url: ctx.url,
      source: 'url-fallback',
    };
  },
};
