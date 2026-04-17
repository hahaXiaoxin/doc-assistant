/**
 * Open Graph 识别策略
 * ---------------------------------------------
 * 读取 <meta property="og:title"> 与 <meta property="og:url">，命中则组装 ArticleIdentity。
 * 多数新闻、博客、知识库页都会埋 og:*，此策略覆盖面宽。
 */
import type { ArticleIdentity, PageContext } from '@doc-assistant/shared';
import type { IdentityStrategy } from '../types';

function getMeta(doc: Document, property: string): string | null {
  const el = doc.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  const content = el?.getAttribute('content')?.trim();
  return content ? content : null;
}

export const OpenGraphStrategy: IdentityStrategy = {
  name: 'open-graph',
  priority: 60,

  extract(ctx: PageContext): ArticleIdentity | null {
    const ogTitle = getMeta(ctx.document, 'og:title');
    const ogUrl = getMeta(ctx.document, 'og:url');
    if (!ogTitle) return null;
    const finalUrl = ogUrl ?? ctx.url;
    return {
      id: `og:${finalUrl}`,
      title: ogTitle,
      url: finalUrl,
      source: 'open-graph',
    };
  },
};
