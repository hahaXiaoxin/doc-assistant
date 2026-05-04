/**
 * PageContextSource
 * ---------------------------------------------
 * 把当前页面的**身份元信息**（标题 + URL + 文章 ID）作为一条 system 消息注入。
 *
 * v1.1 PR-1（Context 瘦身）：
 * - 不再主动注入"正文摘要（summary）"段。主模型需要原文细节时，通过
 *   `read_page_content` 工具按需分页获取（工具已支持 offset/hasMore）。
 * - 不再渲染"摘要只是预览"那段工具使用提示，相关引导改到 system prompt
 *   里统一说明（见 packages/shared/src/config.ts）。
 *
 * 保留理由：
 * - `identityId` 仍是 memory / WorkingMemory 的键；
 * - 标题 + URL 作为最轻量的"你在哪页"线索，不占显著 token。
 */
import type { ContextSegment, ContextSource, AgentInvokeContext } from './source';

export const pageContextSource: ContextSource = {
  name: 'page-context',
  priority: 80,

  async gather(ctx: AgentInvokeContext): Promise<ContextSegment | null> {
    if (!ctx.page) return null;
    const { url, title, identityTitle, identityId } = ctx.page;
    const parts = [
      '# 当前页面上下文',
      `标题：${identityTitle ?? title ?? '未识别'}`,
      `URL：${url}`,
      identityId ? `文章 ID：${identityId}` : null,
    ].filter(Boolean);
    return {
      source: 'page-context',
      message: {
        role: 'system',
        content: parts.join('\n'),
      },
    };
  },
};
