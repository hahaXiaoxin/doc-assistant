/**
 * Tool-calling Loop
 * ---------------------------------------------
 * 核心循环：
 *   while 每轮:
 *     调用 LLM（流式），转发 text-delta/reasoning-delta 给外层
 *     收集本轮的 tool-calls
 *     若无 tool-calls → 结束
 *     否则执行每个 tool，把结果作为 tool role 消息追加到 messages，进入下一轮
 *
 * 设计要点：
 * - 纯函数风格的 async generator，发出归一化的 ChatChunk
 * - 轮数上限（防止 LLM 死循环）：默认 5 轮
 * - 每个 tool 独立 try-catch，单个 tool 失败不中断整体
 */
import {
  createLogger,
  type ChatChunk,
  type ChatMessage,
  type ToolCall,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
} from '@doc-assistant/shared';
import type { LLMProvider } from '@doc-assistant/provider';

const logger = createLogger('agent:loop');

export interface LoopOptions {
  llm: LLMProvider;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  toolExecCtx: ToolExecutionContext;
  signal?: AbortSignal;
  maxTurns?: number;
}

export async function* runAgentLoop(opts: LoopOptions): AsyncIterable<ChatChunk> {
  const maxTurns = opts.maxTurns ?? 5;
  const toolMap = new Map(opts.tools.map((t) => [t.name, t] as const));
  const messages: ChatMessage[] = [...opts.messages];

  for (let turn = 0; turn < maxTurns; turn++) {
    logger.debug(`loop turn ${turn}`);
    const pendingCalls: ToolCall[] = [];
    let assistantText = '';

    const chatParams = {
      messages,
      tools: opts.tools,
      ...(opts.signal ? { signal: opts.signal } : {}),
    };
    const stream = opts.llm.chat(chatParams);

    let finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'abort' | 'error' | 'other' =
      'stop';

    for await (const chunk of stream) {
      // 透传给外层
      yield chunk;

      switch (chunk.type) {
        case 'text-delta':
          assistantText += chunk.delta;
          break;
        case 'tool-call':
          pendingCalls.push(chunk.call);
          break;
        case 'finish':
          finishReason = chunk.finishReason;
          break;
        case 'error':
          // 已经 yield 过 error 了，后续 finish('error') 会终止 loop
          break;
      }
    }

    // 把 assistant 消息（包括 tool_calls）追加到 messages
    const assistantMsg: ChatMessage = { role: 'assistant' };
    if (assistantText) assistantMsg.content = assistantText;
    if (pendingCalls.length) assistantMsg.toolCalls = pendingCalls;
    if (assistantMsg.content || assistantMsg.toolCalls) {
      messages.push(assistantMsg);
    }

    // 终止条件：没有 tool_calls 或遇到终态
    if (finishReason === 'error' || finishReason === 'abort' || finishReason === 'length') {
      return;
    }
    if (!pendingCalls.length) {
      return;
    }

    // 执行 tool calls，结果回灌到 messages
    for (const call of pendingCalls) {
      const result = await executeTool(call, toolMap, opts.toolExecCtx);
      yield { type: 'tool-result', result };
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: serializeToolResult(result),
        meta: { toolName: call.name },
      });
    }
  }

  logger.warn(`达到最大轮数 ${maxTurns}，强制结束`);
  yield { type: 'finish', finishReason: 'length' };
}

async function executeTool(
  call: ToolCall,
  toolMap: Map<string, ToolDefinition>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const tool = toolMap.get(call.name);
  if (!tool) {
    return {
      toolCallId: call.id,
      name: call.name,
      result: `未注册的工具：${call.name}`,
      isError: true,
    };
  }
  try {
    const args = typeof call.args === 'string' ? safeParse(call.args) : (call.args ?? {});
    const out = await tool.execute(args, ctx);
    return { toolCallId: call.id, name: call.name, result: out };
  } catch (err) {
    logger.error(`tool ${call.name} 执行失败:`, (err as Error).message);
    return {
      toolCallId: call.id,
      name: call.name,
      result: `工具执行失败：${(err as Error).message}`,
      isError: true,
    };
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function serializeToolResult(r: ToolResult): string {
  if (typeof r.result === 'string') return r.result;
  try {
    return JSON.stringify(r.result);
  } catch {
    return String(r.result);
  }
}
