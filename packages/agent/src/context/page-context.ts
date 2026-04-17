/**
 * PageContextSource
 * ---------------------------------------------
 * 把当前页面的身份信息与正文摘要作为一条 system 消息注入。
 * - MVP：Agent 层不直接调 Tools 层，而是由 UI/sidebar 在调用 Agent 前把 page.summary 传进来
 * - LLM 再通过 read_page_content tool 可以拿到更完整的正文（按需）
 */
import type { ContextSegment, ContextSource, AgentInvokeContext } from './source';

export const pageContextSource: ContextSource = {
  name: 'page-context',
  priority: 80,

  async gather(ctx: AgentInvokeContext): Promise<ContextSegment | null> {
    if (!ctx.page) return null;
    const { url, title, summary, identityTitle, identityId } = ctx.page;
    const parts = [
      '# 当前页面上下文',
      `标题：${identityTitle ?? title ?? '未识别'}`,
      `URL：${url}`,
      identityId ? `文章 ID：${identityId}` : null,
      summary ? `\n## 正文摘要（仅前若干字，非完整正文）\n${summary}` : null,
      '\n**重要：摘要只是预览。只要用户的问题需要确认原文表述、引用具体段落、统计数据、代码示例等细节，都应当先调用 read_page_content 工具拿完整正文再回答，不要仅凭摘要猜测。**',
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
