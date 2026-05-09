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
 * - 轮数上限（防止 LLM 死循环）：默认来自 shared.DEFAULT_CHAT_SETTINGS.maxTurns（v0.2 = 8）
 * - 每个 tool 独立 try-catch，单个 tool 失败不中断整体
 *
 * finish 语义约定（重要） · 详见 docs/TROUBLESHOOTING.md §2：
 * - 底层每次 LLM HTTP 调用结束都会产生一个 `finish`（finishReason=tool_calls/stop/...）
 * - 这些"每轮 finish"**不**透传给外层，仅用于 loop 内部决策是否进入下一轮
 * - 只有整段多轮对话真正结束时，loop 才自己合成一个 `finish` yield 出去，
 *   这样 UI 层（useStreamingChat）看到 `finish` 时才可安全 break
 * - 若把每轮 finish 都透传，UI 一 break，整条 AsyncGenerator 会被 return() 向下
 *   反向终止，loop 来不及执行 tool、也就不会发起下一轮——引用 tool-calling 场景下
 *   会表现为"模型说要调 tool，但最终没输出结果"。
 *
 * 最后一轮兜底（v0.2 新增，纯 A 方案） · 详见 docs/ROADMAP.md 第二期 §Agent Loop：
 * - 达到 `maxTurns-1`（最后一轮循环内）时：
 *   · 发给 LLM 的请求**不再携带 tools 参数**，强制 LLM 基于已有上下文给出文字回答；
 *   · 在 messages 末尾临时追加一条 system 消息提示"已达上限，请基于已有信息回答"；
 *   · 若 LLM 仍然返回 tool_call（违反指令），代码**直接忽略**（不 yield、不执行、不 push）；
 *   · 若 LLM 无 text 输出、或流提前 error → yield `finish: error` 由 UI 展示"网络不佳"。
 * - 正常场景（≤7 轮收敛）完全不受影响。
 */
import {
  createLogger,
  DEFAULT_CHAT_SETTINGS,
  compact,
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

/** 最后一轮追加的 system 提醒（纯 A 方案） */
const LAST_TURN_SYSTEM_HINT =
  '已达到工具调用上限，请基于已有信息给出最终回答，不要再请求调用工具。';

export async function* runAgentLoop(opts: LoopOptions): AsyncIterable<ChatChunk> {
  const maxTurns = opts.maxTurns ?? DEFAULT_CHAT_SETTINGS.maxTurns;
  const toolMap = new Map(opts.tools.map((t) => [t.name, t] as const));
  const messages: ChatMessage[] = [...opts.messages];

  for (let turn = 0; turn < maxTurns; turn++) {
    const isLastTurn = turn === maxTurns - 1;
    logger.debug(`loop turn ${turn}${isLastTurn ? ' (last turn · 不传 tools 兜底)' : ''}`);

    const pendingCalls: ToolCall[] = [];
    let assistantText = '';
    let sawAnyChunk = false;
    let streamErrored = false;
    let ignoredToolCallCount = 0;

    // 最后一轮：messages 末尾临时追加 system 提醒；tools 不传
    const turnMessages = isLastTurn
      ? [...messages, { role: 'system' as const, content: LAST_TURN_SYSTEM_HINT }]
      : messages;

    const chatParams = {
      messages: turnMessages,
      ...(isLastTurn ? {} : { tools: opts.tools }), // 保留:布尔条件择一(非 null/undefined 判断)
      ...compact({ signal: opts.signal }),
    };
    const stream = opts.llm.chat(chatParams);

    let finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'abort' | 'error' | 'other' =
      'stop';

    for await (const chunk of stream) {
      sawAnyChunk = true;
      switch (chunk.type) {
        case 'text-delta':
          assistantText += chunk.delta;
          yield chunk;
          break;
        case 'reasoning-delta':
          yield chunk;
          break;
        case 'tool-call':
          if (isLastTurn) {
            // 最后一轮忽略 LLM 违反指令的 tool-call：不 yield、不执行、不 push
            ignoredToolCallCount += 1;
          } else {
            pendingCalls.push(chunk.call);
            yield chunk;
          }
          break;
        case 'finish':
          // 只记录、不透传：见文件头注释
          finishReason = chunk.finishReason;
          break;
        case 'error':
          streamErrored = true;
          yield chunk;
          break;
        default:
          yield chunk;
          break;
      }
    }

    if (isLastTurn && ignoredToolCallCount > 0) {
      logger.warn(
        `最后一轮 LLM 仍返回 ${ignoredToolCallCount} 个 tool-call（违反指令），已忽略`,
      );
    }

    // 把 assistant 消息（包括 tool_calls）追加到 messages
    const assistantMsg: ChatMessage = { role: 'assistant' };
    if (assistantText) assistantMsg.content = assistantText;
    if (pendingCalls.length) assistantMsg.toolCalls = pendingCalls;
    if (assistantMsg.content || assistantMsg.toolCalls) {
      messages.push(assistantMsg);
    }

    // 最后一轮的兜底终止分支
    if (isLastTurn) {
      if (streamErrored) {
        // stream 已 yield 过 error chunk，这里只补一个 finish:error 让 UI 明确终止
        yield { type: 'finish', finishReason: 'error' };
        return;
      }
      if (!assistantText && !sawAnyChunk) {
        // 完全无输出（空响应 / 网络异常）→ 报告诚实错误
        logger.error('最后一轮 LLM 无任何输出，报告 finish:error（建议检查网络与日志）');
        yield {
          type: 'error',
          error: new Error('网络不佳，请检查网络或查看日志'),
        };
        yield { type: 'finish', finishReason: 'error' };
        return;
      }
      // 正常收敛：最后一轮给出了文字回答
      yield { type: 'finish', finishReason: finishReason === 'tool_calls' ? 'length' : finishReason };
      return;
    }

    // 非最后一轮：按 finishReason + pendingCalls 决定下一步
    if (finishReason === 'error' || finishReason === 'abort' || finishReason === 'length') {
      yield { type: 'finish', finishReason };
      return;
    }
    if (!pendingCalls.length) {
      yield { type: 'finish', finishReason };
      return;
    }

    logger.debug(`turn ${turn} 收集到 ${pendingCalls.length} 个 tool-call，开始执行`);

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

  // 理论上不会走到这里（最后一轮分支已 return）
  logger.warn(`loop 意外走出 for 循环（maxTurns=${maxTurns}）`);
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
