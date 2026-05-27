/**
 * LLM Tool：读取当前页面主体内容（分页式）
 * ---------------------------------------------
 * 执行时从宿主页面的 document 运行 content pipeline，返回提取到的主体。
 * 注：tool 只能在 content script / sidebar 这种能访问到页面 document 的上下文执行；
 *     Agent 层不应预设执行位置，由调用方通过 ToolExecutionContext.meta 传入 ctx。
 *
 * v1.1 PR-1（Context 瘦身）：
 * - 改为"分页读取"：入参支持 `{ maxChars, offset }`，出参显式返回
 *   `{ content, hasMore, nextOffset?, totalChars, title, extractor }`。
 * - 主模型在 `hasMore === true` 时应主动再次调用以取下一段，直至 `hasMore === false`
 *   或已获取足够上下文（在 system prompt 中同步做了强提示）。
 * - 不再暴露 `excerpt`（之前给 UI PageContextCard 用的简摘已改为 UI 自己读 pipeline，
 *   工具层不再承担"摘要"语义）。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import { runContentPipeline } from '../page/pipeline';

export interface ReadPageContentArgs {
  /** 本次返回的最大字符数；默认 4000；防止超过 LLM 上下文 */
  maxChars?: number;
  /** 从正文的第几个字符开始读；默认 0。用于分页续读；上一次返回的 `nextOffset` 直接传回即可。 */
  offset?: number;
}

export interface ReadPageContentResult {
  ok: true;
  /** 本次返回的正文片段（已按 offset + maxChars 切片，不再带"...[已截断]"标记） */
  content: string;
  /** 是否还有剩余正文未读。true 表示应再次调用本工具并传 `offset = nextOffset` */
  hasMore: boolean;
  /** hasMore=true 时给出的下一段起始位置；hasMore=false 时不返回 */
  nextOffset?: number;
  /** 提取器识别到的正文总字符数（= extracted.content.length） */
  totalChars: number;
  /** 页面标题（提取器给出的） */
  title: string;
  /** 命中的提取器名称（readability / semantic / full-body / ...） */
  extractor: string;
}

export const readPageContentTool: ToolDefinition<ReadPageContentArgs, object> = {
  name: 'read_page_content',
  description:
    [
      '读取当前网页的主体文章内容，支持分页。当用户的问题涉及当前页面内容（引用原文、代码示例、统计数据等细节）时调用此工具。',
      '返回字段：content（本段正文）、hasMore（是否还有剩余）、nextOffset（hasMore=true 时给出的下一段起始位置）、totalChars（正文总字符数）、title、extractor。',
      '**若 hasMore=true，请再次调用本工具并把 offset 设为上次返回的 nextOffset，直到 hasMore=false 或已获取足够上下文，避免只读到一半。**',
    ].join(' '),
  parametersJsonSchema: {
    type: 'object',
    properties: {
      maxChars: {
        type: 'integer',
        description: '本次返回最多保留多少字符，默认 4000',
      },
      offset: {
        type: 'integer',
        description:
          '从正文第几个字符开始读，默认 0。续读时把上次返回的 nextOffset 填进来。',
      },
    },
    required: [],
  },
  async execute(args, ctx) {
    const pageCtx = ctx.meta?.pageContext as
      | { url: string; title: string; document: Document; selectionText?: string }
      | undefined;
    if (!pageCtx) {
      // 注意：tool 内部返回 ok:false 时务必让上层 loop 能感知到这是"逻辑失败"，
      // 通过抛错让 loop.executeTool 捕获并标记 isError=true。
      throw new Error(
        'pageContext is not provided; tool must be executed in content/sidebar with meta.pageContext set',
      );
    }
    const extracted = runContentPipeline({
      url: pageCtx.url,
      title: pageCtx.title,
      document: pageCtx.document,
      ...(pageCtx.selectionText ? { selectionText: pageCtx.selectionText } : {}), // 保留:原语义需要排除空字符串
    });
    if (!extracted) {
      throw new Error('未能从当前页面提取到主体内容');
    }
    const maxChars = Math.max(1, args.maxChars ?? 4000);
    const rawOffset = Math.floor(args.offset ?? 0);
    const total = extracted.content.length;
    // 非法 offset 夹到合法范围：负数 → 0；越界 → total（空切片 + hasMore=false）
    const offset = Math.min(Math.max(0, rawOffset), total);
    const end = Math.min(offset + maxChars, total);
    const slice = extracted.content.slice(offset, end);
    const hasMore = end < total;

    const result: ReadPageContentResult = {
      ok: true,
      content: slice,
      hasMore,
      totalChars: total,
      title: extracted.title,
      extractor: extracted.extractor,
    };
    if (hasMore) result.nextOffset = end;
    return result;
  },
};
