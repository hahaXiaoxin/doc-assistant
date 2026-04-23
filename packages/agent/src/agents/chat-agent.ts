/**
 * ChatAgent · 主对话 Agent 工厂
 * ---------------------------------------------
 * v0.2.0：`phase2: true` 开关使用 Phase2-0 ContextSource 组合（加入 Persona/SessionTopic/WorkingMemory）。
 * v0.2.1：当 `phase2=true` 且传入 `auxLLM` 时，自动升级为 Phase2-1 组合（额外加入 RelevantMemorySource）。
 *
 * PHASE3: CheckerAgent（实时提醒）作为另一个 Agent 子类与此并列存在，
 *   共享 LLM/Memory/Orchestrator，但有自己的 sources。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type { LLMProvider } from '@doc-assistant/provider';
import type { MemoryStore } from '@doc-assistant/memory';
import { Agent } from '../agent';
import {
  buildDefaultMVPSources,
  buildDefaultPhase2_0Sources,
  buildDefaultPhase2_1Sources,
} from '../context';

export interface CreateChatAgentOptions {
  llm: LLMProvider;
  memory: MemoryStore;
  tools: ToolDefinition[];
  systemPrompt: string;
  maxHistoryChars: number;
  maxTurns?: number;
  /**
   * v0.2：使用 Phase2 ContextSource 组合。
   * - `phase2=true` 且无 auxLLM → Phase2-0（Persona/SessionTopic/WorkingMemory）
   * - `phase2=true` 且有 auxLLM → Phase2-1（在 Phase2-0 基础上加 RelevantMemorySource）
   * 默认 false（保持 MVP 行为）。
   */
  phase2?: boolean;
  /** Persona Top-K（phase2 生效） */
  personaTopK?: number;
  /**
   * v0.2.1：辅助 LLM。传入后 Phase2-1 组合会启用 aux-intent 精判；
   * 不传则 RelevantMemorySource 会跳过 aux 精判只走粗判+向量。
   */
  auxLLM?: LLMProvider | null;
  /** v0.2.1：RelevantMemorySource 参数（limit/neighborWindow/enableAuxIntent） */
  relevantMemory?: {
    limit?: number;
    neighborWindow?: number;
    enableAuxIntent?: boolean;
  };
}

export function createChatAgent(opts: CreateChatAgentOptions): Agent {
  let sources;
  if (opts.phase2) {
    // Phase2-1 触发条件：显式开启 phase2 即使用。auxLLM 可为 null（此时 RelevantMemorySource 只跑粗判+向量）
    sources = buildDefaultPhase2_1Sources({
      systemPrompt: opts.systemPrompt,
      maxHistoryChars: opts.maxHistoryChars,
      memory: opts.memory,
      ...(opts.personaTopK !== undefined ? { personaTopK: opts.personaTopK } : {}),
      ...(opts.auxLLM !== undefined ? { auxLLM: opts.auxLLM } : {}),
      ...(opts.relevantMemory !== undefined ? { relevantMemory: opts.relevantMemory } : {}),
    });
  } else {
    sources = buildDefaultMVPSources({
      systemPrompt: opts.systemPrompt,
      maxHistoryChars: opts.maxHistoryChars,
    });
  }
  // 保留 Phase2-0 的显式工厂，便于测试/回滚使用
  void buildDefaultPhase2_0Sources;

  return new Agent({
    name: 'chat',
    role: '面向文档阅读的通用对话助手',
    llm: opts.llm,
    memory: opts.memory,
    tools: opts.tools,
    sources,
    ...(typeof opts.maxTurns === 'number' ? { maxTurns: opts.maxTurns } : {}),
  });
}
