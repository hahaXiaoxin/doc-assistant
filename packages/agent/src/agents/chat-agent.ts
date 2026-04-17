/**
 * ChatAgent · 主对话 Agent 工厂
 * ---------------------------------------------
 * 使用 MVP 默认 ContextSource 组合 + 默认 MVP tools。
 *
 * PHASE3: CheckerAgent（实时提醒）作为另一个 Agent 子类与此并列存在，
 *   共享 LLM/Memory/Orchestrator，但有自己的 sources（更偏向新增内容差异）。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type { LLMProvider } from '@doc-assistant/provider';
import type { MemoryStore } from '@doc-assistant/memory';
import { Agent } from '../agent';
import { buildDefaultMVPSources } from '../context';

export interface CreateChatAgentOptions {
  llm: LLMProvider;
  memory: MemoryStore;
  tools: ToolDefinition[];
  systemPrompt: string;
  maxHistoryChars: number;
  maxTurns?: number;
}

export function createChatAgent(opts: CreateChatAgentOptions): Agent {
  return new Agent({
    name: 'chat',
    role: '面向文档阅读的通用对话助手',
    llm: opts.llm,
    memory: opts.memory,
    tools: opts.tools,
    sources: buildDefaultMVPSources({
      systemPrompt: opts.systemPrompt,
      maxHistoryChars: opts.maxHistoryChars,
    }),
    ...(typeof opts.maxTurns === 'number' ? { maxTurns: opts.maxTurns } : {}),
  });
}
