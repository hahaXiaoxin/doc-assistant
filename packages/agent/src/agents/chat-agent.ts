/**
 * ChatAgent · 主对话 Agent 工厂
 * ---------------------------------------------
 * 组装 ContextSource 组合：System / Reference / Persona / SessionTopic /
 * WorkingMemory / RelevantMemory / ChatHistory。若传入 `auxLLM`,
 * RelevantMemorySource 会启用 aux-intent 精判；否则只跑粗判 + 向量。
 *
 * PHASE3: CheckerAgent(实时提醒)作为另一个 Agent 子类与此并列存在,
 *   共享 LLM/Memory/Orchestrator,但有自己的 sources。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type { LLMProvider } from '@doc-assistant/provider';
import type { MemoryStore } from '@doc-assistant/memory';
import { Agent } from '../agent';
import { buildDefaultSources } from '../context';

export interface CreateChatAgentOptions {
  llm: LLMProvider;
  memory: MemoryStore;
  tools: ToolDefinition[];
  systemPrompt: string;
  maxHistoryChars: number;
  maxTurns?: number;
  /** Persona · 对 agent 的定义 Top-K(默认 10) */
  agentPersonaTopK?: number;
  /** Persona · 对 user 的定义 Top-K(默认 8) */
  userPersonaTopK?: number;
  /**
   * 辅助 LLM。传入后 RelevantMemorySource 会启用 aux-intent 精判;
   * 不传则只走粗判 + 向量。
   */
  auxLLM?: LLMProvider | null;
  /** RelevantMemorySource 参数(limit/neighborWindow/enableAuxIntent) */
  relevantMemory?: {
    limit?: number;
    neighborWindow?: number;
    enableAuxIntent?: boolean;
  };
}

export function createChatAgent(opts: CreateChatAgentOptions): Agent {
  const sources = buildDefaultSources({
    systemPrompt: opts.systemPrompt,
    maxHistoryChars: opts.maxHistoryChars,
    memory: opts.memory,
    ...(opts.agentPersonaTopK !== undefined ? { agentPersonaTopK: opts.agentPersonaTopK } : {}),
    ...(opts.userPersonaTopK !== undefined ? { userPersonaTopK: opts.userPersonaTopK } : {}),
    ...(opts.auxLLM !== undefined ? { auxLLM: opts.auxLLM } : {}),
    ...(opts.relevantMemory !== undefined ? { relevantMemory: opts.relevantMemory } : {}),
  });

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
