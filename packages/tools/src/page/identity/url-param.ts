/**
 * URL 参数识别策略
 * ---------------------------------------------
 * 匹配常见文章类参数：id / docId / doc / p / articleId / pageId / aid，
 * 若命中则以 "<hostname>/<path>?<key>=<value>" + 当前 title 组装 ArticleIdentity。
 */
import type { PageContext, ArticleIdentity } from '@doc-assistant/shared';
import type { IdentityStrategy } from '../types';

const ARTICLE_PARAM_KEYS = ['id', 'docId', 'doc', 'p', 'articleId', 'pageId', 'aid'];

export const UrlParamStrategy: IdentityStrategy = {
  name: 'url-param',
  priority: 50,

  extract(ctx: PageContext): ArticleIdentity | null {
    try {
      const u = new URL(ctx.url);
      for (const key of ARTICLE_PARAM_KEYS) {
        const val = u.searchParams.get(key);
        if (val) {
          return {
            id: `${u.hostname}${u.pathname}?${key}=${val}`,
            title: ctx.title || val,
            url: ctx.url,
            source: 'url-param',
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  },
};
