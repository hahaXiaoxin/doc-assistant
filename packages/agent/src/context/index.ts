/**
 * ContextSource 汇总
 * ---------------------------------------------
 * 提供 MVP 默认 Source 组合工厂。PHASE2 追加的 Source 在此处新增即可。
 */
export type { AgentInvokeContext, ContextSegment, ContextSource } from './source';
export { createSystemPromptSource } from './system-prompt';
export { pageContextSource } from './page-context';
export { referenceTagSource } from './reference-tag';
export { createChatHistorySource } from './chat-history';

import type { ContextSource } from './source';
import { createSystemPromptSource } from './system-prompt';
import { pageContextSource } from './page-context';
import { referenceTagSource } from './reference-tag';
import { createChatHistorySource } from './chat-history';

export interface DefaultMVPSourcesOptions {
  systemPrompt: string;
  maxHistoryChars: number;
}

/** MVP 默认 Source 组合：System / Page / Reference / ChatHistory */
export function buildDefaultMVPSources(opts: DefaultMVPSourcesOptions): ContextSource[] {
  return [
    createSystemPromptSource(opts.systemPrompt),
    pageContextSource,
    referenceTagSource,
    createChatHistorySource(opts.maxHistoryChars),
  ];
}

// PHASE2:
// - LongTermMemorySource：从 MemoryStore 拉取 fact 类型记录（用户偏好等）
// - RelevantMemorySource：按语义召回相关历史片段
// - SessionSummarySource：当前会话过长时提供压缩摘要
// 详见 docs/ROADMAP.md §2
