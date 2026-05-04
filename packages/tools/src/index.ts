/**
 * @doc-assistant/tools · 入口
 * ---------------------------------------------
 * 职责：
 * - 页面内容提取（Identity + Content 双 pipeline）
 * - LLM Tool 定义（提供给 Agent 注入到 LLM 的本地工具清单）
 *
 * 架构约束：
 * - 目前不接入 tesseract.js；OCR 仅定义接口骨架。详见 docs/ROADMAP.md §3。
 */

export { Registry } from './registry';
export type { PriorityItem } from './registry';

// 页面提取
export * from './page/types';
export * from './page/pipeline';
export {
  identityRegistry,
  registerDefaultIdentityStrategies,
  UrlParamStrategy,
  OpenGraphStrategy,
  JsonLdStrategy,
  HeadingStrategy,
  UrlFallbackStrategy,
} from './page/identity';
export {
  contentRegistry,
  registerDefaultContentExtractors,
  ReadabilityExtractor,
  SemanticTagExtractor,
  SelectionExtractor,
  FullBodyExtractor,
} from './page/content';

// LLM Tool 定义
export * from './definitions';

// OCR 接口骨架（PHASE3）
export type { OCRStrategy, OCRInput, OCRResult } from './ocr/interface';
