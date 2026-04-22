/**
 * Agent 基类
 * ---------------------------------------------
 * 职责：
 * - 持有角色/LLM/tools/sources/memory
 * - run(): 用 ContextSource 组装 messages → 调 runAgentLoop
 * - 每个 Agent 实例可以有自己独立的 Source 组合与 tools 子集
 *
 * 架构红线（ESLint 强约束）：
 * - 本文件不得 import 'ai' / '@ai-sdk/*'
 * - 所有 LLM 访问通过 this.llm（LLMProvider 接口）
 */
import {
  createLogger,
  DEFAULT_CHAT_SETTINGS,
  type ChatChunk,
  type ChatMessage,
  type ToolDefinition,
  type ToolExecutionContext,
} from '@doc-assistant/shared';
import type { LLMProvider } from '@doc-assistant/provider';
import type { MemoryStore } from '@doc-assistant/memory';
import type { AgentInvokeContext, ContextSource } from './context';
import { runAgentLoop } from './loop';

export interface AgentOptions {
  name: string;
  role: string;
  llm: LLMProvider;
  sources: ContextSource[];
  tools: ToolDefinition[];
  memory: MemoryStore;
  maxTurns?: number;
}

export class Agent {
  readonly name: string;
  readonly role: string;

  protected readonly llm: LLMProvider;
  protected readonly sources: ContextSource[];
  protected readonly tools: ToolDefinition[];
  protected readonly memory: MemoryStore;
  protected readonly maxTurns: number;

  private readonly logger;

  constructor(opts: AgentOptions) {
    this.name = opts.name;
    this.role = opts.role;
    this.llm = opts.llm;
    this.sources = opts.sources;
    this.tools = opts.tools;
    this.memory = opts.memory;
    this.maxTurns = opts.maxTurns ?? DEFAULT_CHAT_SETTINGS.maxTurns;
    this.logger = createLogger(`agent:${this.name}`);
  }

  /**
   * 运行 Agent：返回流式 ChatChunk 供 UI 消费。
   */
  async *run(
    invokeCtx: AgentInvokeContext,
    execCtx: ToolExecutionContext,
  ): AsyncIterable<ChatChunk> {
    const messages = await this.composeMessages(invokeCtx);
    this.logger.debug(`组装消息完成，共 ${messages.length} 条，进入 loop`);

    const loopOpts = {
      llm: this.llm,
      messages,
      tools: this.tools,
      toolExecCtx: execCtx,
      maxTurns: this.maxTurns,
      ...(execCtx.signal ? { signal: execCtx.signal } : {}),
    };
    for await (const chunk of runAgentLoop(loopOpts)) {
      yield chunk;
    }
  }

  /**
   * 收集所有 ContextSource 的输出，按 priority 降序合并为 messages 数组。
   * 特殊处理 chat-history：其 segment 的 meta.historyMessages 会被展开为多条消息。
   */
  protected async composeMessages(ctx: AgentInvokeContext): Promise<ChatMessage[]> {
    // 并行收集，再按 priority 排序
    const results = await Promise.all(
      this.sources.map((s) => s.gather(ctx).catch((err) => {
        this.logger.warn(`ContextSource ${s.name} 收集失败:`, (err as Error).message);
        return null;
      })),
    );

    const paired = results
      .map((seg, i) => ({ seg, priority: this.sources[i]?.priority ?? 0 }))
      .filter((p): p is { seg: NonNullable<typeof p.seg>; priority: number } => p.seg != null)
      .sort((a, b) => b.priority - a.priority);

    const messages: ChatMessage[] = [];
    for (const { seg } of paired) {
      const placeholderHistory = seg.message.meta?.historyMessages;
      if (Array.isArray(placeholderHistory)) {
        messages.push(...(placeholderHistory as ChatMessage[]));
      } else {
        messages.push(seg.message);
      }
    }

    // 当前轮用户输入作为最后一条 user message
    messages.push({ role: 'user', content: ctx.userInput });
    return messages;
  }
}
