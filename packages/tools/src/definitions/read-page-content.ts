/**
 * LLM Tool：读取当前页面主体内容
 * ---------------------------------------------
 * 执行时从宿主页面的 document 运行 content pipeline，返回提取到的主体。
 * 注：tool 只能在 content script / sidebar 这种能访问到页面 document 的上下文执行；
 *     Agent 层不应预设执行位置，由调用方通过 ToolExecutionContext.meta 传入 ctx。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import { runContentPipeline } from '../page/pipeline';

export interface ReadPageContentArgs {
  /** 最大返回字符数；防止超过 LLM 上下文 */
  maxChars?: number;
}

export const readPageContentTool: ToolDefinition<ReadPageContentArgs, object> = {
  name: 'read_page_content',
  description:
    '读取当前网页的主体文章内容。当用户的问题涉及当前页面内容时调用此工具。返回包含 title、content、excerpt、extractor 字段的 JSON。',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      maxChars: {
        type: 'integer',
        description: '主体内容最多保留多少字符，默认 4000',
      },
    },
    required: [],
  },
  async execute(args, ctx) {
    const pageCtx = ctx.meta?.pageContext as
      | { url: string; title: string; document: Document; selectionText?: string }
      | undefined;
    if (!pageCtx) {
      return {
        ok: false,
        error: 'pageContext is not provided; tool must be executed in content/sidebar with meta.pageContext set',
      };
    }
    const extracted = runContentPipeline({
      url: pageCtx.url,
      title: pageCtx.title,
      document: pageCtx.document,
      ...(pageCtx.selectionText ? { selectionText: pageCtx.selectionText } : {}),
    });
    if (!extracted) return { ok: false, error: '未能提取到页面主体' };
    const maxChars = args.maxChars ?? 4000;
    return {
      ok: true,
      title: extracted.title,
      content:
        extracted.content.length > maxChars
          ? extracted.content.slice(0, maxChars) + '…[已截断]'
          : extracted.content,
      excerpt: extracted.excerpt,
      extractor: extracted.extractor,
      charCount: extracted.charCount,
    };
  },
};
