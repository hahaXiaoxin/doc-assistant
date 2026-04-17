/**
 * LLM Tool：获取当前用户选中的文本
 * ---------------------------------------------
 * 返回 selectionText；若无选区则返回空字符串。
 */
import type { ToolDefinition } from '@doc-assistant/shared';

export const getSelectionTextTool: ToolDefinition<Record<string, never>, object> = {
  name: 'get_selection_text',
  description:
    '返回用户当前在页面中选中的文本。当用户提到"这段"、"这里"或需要针对选中内容回答时调用。',
  parametersJsonSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_args, ctx) {
    const pageCtx = ctx.meta?.pageContext as { selectionText?: string } | undefined;
    return { ok: true, text: pageCtx?.selectionText ?? '' };
  },
};
