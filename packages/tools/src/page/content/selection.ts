/**
 * 用户选区提取器
 * ---------------------------------------------
 * 当 PageContext.selectionText 非空时激活；优先级 90（高于 Readability）。
 *
 * ⚠️ 当前交互下几乎不会被真正触发 —— 请阅读以下说明避免误解：
 *
 * 这个提取器的期望触发路径是"**不夺焦的提问交互**"：用户在页面上划词后，
 * 直接通过右键菜单 / 悬浮按钮发起提问，浏览器的 Selection 仍保留在 document 上，
 * tool 执行时 `window.getSelection()` 才能拿到用户的划词文本。
 *
 * 但当前的主交互是"划词 → 点'引用到 Doc Assistant' → Lexical chip → 输入问题"：
 * - selection-toolbar 在派发引用事件后会主动 `removeAllRanges()` 清掉选区
 * - 用户 focus sidebar 输入框时浏览器也会自动把选区转移到 contenteditable
 * - 上述两种情况下 tool 执行时 `selectionText === ""`，SelectionExtractor 不激活
 *
 * 也就是说：本提取器是**面向未来交互的占位抽象**，实际保底仍由 Readability 兜底。
 *
 * PHASE2: 实现"右键菜单问选中文本 / 划词悬浮输入框"后，本提取器会真正发挥作用。
 *         届时还需考虑与 ReferenceNode 引用机制的冲突避免（防止同一段文本被
 *         作为"引用 + 页面上下文"重复注入）。详见 docs/ROADMAP.md。
 *
 * 注意：`buildPageSummary` **故意排除**了本提取器，避免用户划词后整个页面摘要
 * 突然坍缩成选区文本，那会很反直觉。
 */
import type { ExtractedContent, PageContext } from '@doc-assistant/shared';
import type { ContentExtractor } from '../types';
import { makeExtractedContent } from './_util';

export const SelectionExtractor: ContentExtractor = {
  name: 'selection',
  priority: 90,

  canHandle(ctx: PageContext): boolean {
    return Boolean(ctx.selectionText && ctx.selectionText.trim().length > 0);
  },

  extract(ctx: PageContext): ExtractedContent | null {
    const text = ctx.selectionText?.trim() ?? '';
    if (!text) return null;
    return makeExtractedContent({
      title: ctx.title || '用户选中文本',
      content: text,
      extractor: 'selection',
    });
  },
};
