/**
 * ContextSource 汇总
 * ---------------------------------------------
 * 提供 MVP 默认 Source 组合 + v0.2 Phase2-0/2-1 扩展组合。
 *
 * v0.2.0 扩展点：新增 Persona / SessionTopic / WorkingMemory 三个 Source。
 * v0.2.1 扩展点：新增 RelevantMemorySource（priority=40，按需召回）。
 * 数据来自 MemoryStore；若 store 无数据（新用户 / NullStore），Source 返回 null，不贡献段落。
 */
export type { AgentInvokeContext, ContextSegment, ContextSource } from './source';
export { createSystemPromptSource } from './system-prompt';
export { referenceTagSource } from './reference-tag';
export { createChatHistorySource } from './chat-history';
export { createPersonaSource, type PersonaSourceOptions } from './persona';
export { createSessionTopicSource } from './session-topic';
export { createWorkingMemorySource } from './working-memory';
export {
  createRelevantMemorySource,
  renderRecallMatches,
  type RelevantMemorySourceOptions,
} from './relevant-memory';
export {
  recallMemory,
  type RecallMode,
  type RecallInput,
  type RecallOutcome,
  type RecallMatch,
  type RecallNeighbor,
  type RecallDeps,
} from './recall';
export {
  detectRecallTrigger,
  buildRecentHistoryHint,
  type RecallTriggerResult,
} from './recall-triggers';
export {
  detectTimeScopedMetaQuery,
  resolveTimeRange,
  type TimeRangeKey,
  type ResolveTimeRangeOptions,
} from './time-query';

import type { LLMProvider } from '@doc-assistant/provider';
import type { ContextSource } from './source';
import type { MemoryStore } from '@doc-assistant/memory';
import { createSystemPromptSource } from './system-prompt';
import { referenceTagSource } from './reference-tag';
import { createChatHistorySource } from './chat-history';
import { createPersonaSource } from './persona';
import { createSessionTopicSource } from './session-topic';
import { createWorkingMemorySource } from './working-memory';
import { createRelevantMemorySource } from './relevant-memory';

export interface DefaultMVPSourcesOptions {
  systemPrompt: string;
  maxHistoryChars: number;
}

/** MVP 默认 Source 组合：System / Reference / ChatHistory */
export function buildDefaultMVPSources(opts: DefaultMVPSourcesOptions): ContextSource[] {
  return [
    createSystemPromptSource(opts.systemPrompt),
    referenceTagSource,
    createChatHistorySource(opts.maxHistoryChars),
  ];
}

export interface DefaultPhase2SourcesOptions extends DefaultMVPSourcesOptions {
  memory: MemoryStore;
  /** 对 agent 的定义注入条数上限（默认 10，见 PersonaSourceOptions） */
  agentPersonaTopK?: number;
  /** 对 user 的定义注入条数上限（默认 8，见 PersonaSourceOptions） */
  userPersonaTopK?: number;
}

/**
 * v0.2.0 默认 Source 组合：System + Reference + Persona/SessionTopic/WorkingMemory + ChatHistory
 */
export function buildDefaultPhase2_0Sources(opts: DefaultPhase2SourcesOptions): ContextSource[] {
  return [
    createSystemPromptSource(opts.systemPrompt),
    referenceTagSource,
    createPersonaSource(opts.memory, personaOptsFrom(opts)),
    createSessionTopicSource(opts.memory),
    createWorkingMemorySource(opts.memory),
    createChatHistorySource(opts.maxHistoryChars),
  ];
}

export interface DefaultPhase2_1SourcesOptions extends DefaultPhase2SourcesOptions {
  /** 辅助 LLM（用于召回链的 aux-intent 精判；可空） */
  auxLLM?: LLMProvider | null;
  /** RelevantMemorySource 参数 */
  relevantMemory?: {
    limit?: number;
    neighborWindow?: number;
    /** 默认 true；为 false 会跳过 aux 精判，只走粗判 + 向量 */
    enableAuxIntent?: boolean;
  };
}

/**
 * v0.2.1 默认 Source 组合：Phase2_0 + RelevantMemorySource（priority=40，按需召回）
 */
export function buildDefaultPhase2_1Sources(
  opts: DefaultPhase2_1SourcesOptions,
): ContextSource[] {
  return [
    createSystemPromptSource(opts.systemPrompt),
    referenceTagSource,
    createPersonaSource(opts.memory, personaOptsFrom(opts)),
    createSessionTopicSource(opts.memory),
    createWorkingMemorySource(opts.memory),
    createRelevantMemorySource(opts.memory, opts.auxLLM ?? null, opts.relevantMemory ?? {}),
    createChatHistorySource(opts.maxHistoryChars),
  ];
}

/**
 * v0.4.0：把 DefaultPhase2SourcesOptions 里的 agentPersonaTopK / userPersonaTopK
 * 折成 PersonaSourceOptions；缺省字段由 createPersonaSource 内部兜底。
 */
function personaOptsFrom(opts: DefaultPhase2SourcesOptions): import('./persona').PersonaSourceOptions {
  const personaOpts: import('./persona').PersonaSourceOptions = {};
  if (opts.agentPersonaTopK !== undefined) personaOpts.agentTopK = opts.agentPersonaTopK;
  if (opts.userPersonaTopK !== undefined) personaOpts.userTopK = opts.userPersonaTopK;
  return personaOpts;
}
