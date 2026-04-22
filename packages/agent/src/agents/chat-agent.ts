/**
 * ChatAgent · 主对话 Agent 工厂
 * ---------------------------------------------
 * v0.2：新增 `phase2: true` 开关，使用 Phase2 ContextSource 组合（加入 Persona/SessionTopic/WorkingMemory）。
 * 默认仍为 MVP 组合，向后兼容。
 *
 * PHASE3: CheckerAgent（实时提醒）作为另一个 Agent 子类与此并列存在，
 *   共享 LLM/Memory/Orchestrator，但有自己的 sources。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type { LLMProvider } from '@doc-assistant/provider';
import type { MemoryStore } from '@doc-assistant/memory';
import { Agent } from '../agent';
import { buildDefaultMVPSources, buildDefaultPhase2_0Sources } from '../context';

export interface CreateChatAgentOptions {
  llm: LLMProvider;
  memory: MemoryStore;
  tools: ToolDefinition[];
  systemPrompt: string;
  maxHistoryChars: number;
  maxTurns?: number;
  /**
   * v0.2：使用 Phase2-0 ContextSource 组合（加入 Persona/SessionTopic/WorkingMemory）。
   * 默认 false（保持 MVP 行为，便于测试/回滚）。
   */
  phase2?: boolean;
  /** Persona Top-K（phase2=true 生效） */
  personaTopK?: number;
}

export function createChatAgent(opts: CreateChatAgentOptions): Agent {
  const sources = opts.phase2
    ? buildDefaultPhase2_0Sources({
        systemPrompt: opts.systemPrompt,
        maxHistoryChars: opts.maxHistoryChars,
        memory: opts.memory,
        ...(opts.personaTopK !== undefined ? { personaTopK: opts.personaTopK } : {}),
      })
    : buildDefaultMVPSources({
        systemPrompt: opts.systemPrompt,
        maxHistoryChars: opts.maxHistoryChars,
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
