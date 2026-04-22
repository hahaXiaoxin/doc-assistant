/**
 * ContextSource 汇总
 * ---------------------------------------------
 * 提供 MVP 默认 Source 组合 + v0.2 Phase2-0 扩展组合。
 *
 * v0.2.0 扩展点：新增 Persona / SessionTopic / WorkingMemory 三个 Source。
 * 数据来自 MemoryStore；若 store 无数据（新用户 / NullStore），Source 返回 null，不贡献段落。
 *
 * v0.2.1 将再加入 RelevantMemorySource（priority=40，按需召回）。
 */
export type { AgentInvokeContext, ContextSegment, ContextSource } from './source';
export { createSystemPromptSource } from './system-prompt';
export { pageContextSource } from './page-context';
export { referenceTagSource } from './reference-tag';
export { createChatHistorySource } from './chat-history';
export { createPersonaSource, type PersonaSourceOptions } from './persona';
export { createSessionTopicSource } from './session-topic';
export { createWorkingMemorySource } from './working-memory';

import type { ContextSource } from './source';
import type { MemoryStore } from '@doc-assistant/memory';
import { createSystemPromptSource } from './system-prompt';
import { pageContextSource } from './page-context';
import { referenceTagSource } from './reference-tag';
import { createChatHistorySource } from './chat-history';
import { createPersonaSource } from './persona';
import { createSessionTopicSource } from './session-topic';
import { createWorkingMemorySource } from './working-memory';

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

export interface DefaultPhase2SourcesOptions extends DefaultMVPSourcesOptions {
  memory: MemoryStore;
  /** Persona 注入条数上限 */
  personaTopK?: number;
}

/**
 * v0.2.0 默认 Source 组合：MVP 4 个 + Persona/SessionTopic/WorkingMemory 3 个 = 7 个
 * v0.2.1 将新增 RelevantMemorySource（由召回链路使用，单独暴露 buildDefaultPhase2_1Sources）。
 */
export function buildDefaultPhase2_0Sources(opts: DefaultPhase2SourcesOptions): ContextSource[] {
  return [
    createSystemPromptSource(opts.systemPrompt),
    pageContextSource,
    referenceTagSource,
    createPersonaSource(opts.memory, opts.personaTopK !== undefined ? { topK: opts.personaTopK } : {}),
    createSessionTopicSource(opts.memory),
    createWorkingMemorySource(opts.memory),
    createChatHistorySource(opts.maxHistoryChars),
  ];
}
