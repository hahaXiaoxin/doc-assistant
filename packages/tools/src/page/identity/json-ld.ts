/**
 * JSON-LD 识别策略
 * ---------------------------------------------
 * 解析 <script type="application/ld+json"> 中的结构化数据，
 * 匹配 Article / NewsArticle / BlogPosting / TechArticle，取 headline + @id / url。
 */
import type { ArticleIdentity, PageContext } from '@doc-assistant/shared';
import type { IdentityStrategy } from '../types';

const ARTICLE_TYPES = new Set([
  'Article',
  'NewsArticle',
  'BlogPosting',
  'TechArticle',
  'ScholarlyArticle',
  'Report',
]);

interface ArticleLd {
  '@type'?: string | string[];
  '@id'?: string;
  url?: string;
  headline?: string;
  name?: string;
}

function matchesArticleType(type: unknown): boolean {
  if (typeof type === 'string') return ARTICLE_TYPES.has(type);
  if (Array.isArray(type)) return type.some((t) => typeof t === 'string' && ARTICLE_TYPES.has(t));
  return false;
}

function findArticleNode(value: unknown): ArticleLd | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findArticleNode(v);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (matchesArticleType(obj['@type'])) {
      return obj as ArticleLd;
    }
    // 嵌套 @graph
    if (Array.isArray(obj['@graph'])) {
      return findArticleNode(obj['@graph']);
    }
  }
  return null;
}

export const JsonLdStrategy: IdentityStrategy = {
  name: 'json-ld',
  priority: 70,

  extract(ctx: PageContext): ArticleIdentity | null {
    const scripts = ctx.document.querySelectorAll<HTMLScriptElement>(
      'script[type="application/ld+json"]',
    );
    for (const s of Array.from(scripts)) {
      const raw = s.textContent?.trim();
      if (!raw) continue;
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      const article = findArticleNode(data);
      if (!article) continue;
      const headline = article.headline ?? article.name;
      if (!headline) continue;
      const id = article['@id'] ?? article.url ?? ctx.url;
      return {
        id: `jsonld:${id}`,
        title: String(headline),
        url: article.url ?? ctx.url,
        source: 'json-ld',
      };
    }
    return null;
  },
};
