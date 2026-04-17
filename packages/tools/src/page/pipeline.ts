/**
 * 页面提取流水线
 * ---------------------------------------------
 * 两个独立 pipeline：
 * - runIdentityPipeline：按 priority 降序尝试每个 IdentityStrategy，首个返回非 null 即为结果
 * - runContentPipeline：同上，但先过滤 canHandle
 *
 * PHASE2: 动态识别器（基于域名 DSL）通过 registry.register 注入后自动参与调度。
 */
import type { ArticleIdentity, ExtractedContent, PageContext } from '@doc-assistant/shared';
import { createLogger } from '@doc-assistant/shared';
import { identityRegistry } from './identity';
import { contentRegistry } from './content';
import type { ContentExtractor, IdentityStrategy } from './types';

const logger = createLogger('tools:pipeline');

export function runIdentityPipeline(
  ctx: PageContext,
  strategies: IdentityStrategy[] = identityRegistry.list(),
): ArticleIdentity {
  for (const strategy of strategies) {
    const result = strategy.extract(ctx);
    if (result) {
      logger.debug(`身份识别命中: ${strategy.name}`);
      return result;
    }
  }
  // 理论上 UrlFallbackStrategy 总会命中；兜底防御
  return {
    id: `fallback:${ctx.url}`,
    title: ctx.title || ctx.url,
    url: ctx.url,
    source: 'fallback',
  };
}

export function runContentPipeline(
  ctx: PageContext,
  extractors: ContentExtractor[] = contentRegistry.list(),
): ExtractedContent | null {
  for (const extractor of extractors) {
    if (!extractor.canHandle(ctx)) continue;
    const result = extractor.extract(ctx);
    if (result) {
      logger.debug(`内容提取命中: ${extractor.name} (${result.charCount} chars)`);
      return result;
    }
  }
  logger.warn('所有内容提取器都失败');
  return null;
}
