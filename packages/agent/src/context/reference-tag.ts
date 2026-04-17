/**
 * ReferenceTagSource
 * ---------------------------------------------
 * 用户通过划词在输入框中插入的 ReferenceNode 会被 UI 层序列化为带 <ref> 标签的文本。
 * 这里把它作为一条独立的 system 消息注入，告知 LLM "用户显式引用了这些片段"。
 *
 * 若输入框无引用，则本 source 返回 null（不贡献段落）。
 */
import type { ContextSegment, ContextSource, AgentInvokeContext } from './source';

export const referenceTagSource: ContextSource = {
  name: 'reference-tag',
  priority: 70,

  async gather(ctx: AgentInvokeContext): Promise<ContextSegment | null> {
    if (!ctx.references?.trim()) return null;
    return {
      source: 'reference-tag',
      message: {
        role: 'system',
        content: `用户在提问中显式引用了以下片段（保留其原文）：\n${ctx.references.trim()}`,
      },
    };
  },
};
