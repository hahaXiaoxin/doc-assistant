/**
 * LLM Tool：获取当前文章的身份信息
 * ---------------------------------------------
 * 返回 runIdentityPipeline 的结果（id/title/url/source），
 * 便于 LLM 引用"这是哪一篇文章"。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import { runIdentityPipeline } from '../page/pipeline';

export const getPageIdentityTool: ToolDefinition<Record<string, never>, object> = {
  name: 'get_page_identity',
  description:
    '获取当前网页的文章身份信息，包括稳定 id、标题、url。当需要引用当前文章或记录来源时调用。',
  parametersJsonSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_args, ctx) {
    const pageCtx = ctx.meta?.pageContext as
      | { url: string; title: string; document: Document; selectionText?: string }
      | undefined;
    if (!pageCtx) {
      return { ok: false, error: 'pageContext 未提供' };
    }
    const identity = runIdentityPipeline({
      url: pageCtx.url,
      title: pageCtx.title,
      document: pageCtx.document,
      ...(pageCtx.selectionText ? { selectionText: pageCtx.selectionText } : {}), // 保留:原语义需要排除空字符串
    });
    return { ok: true, ...identity };
  },
};
