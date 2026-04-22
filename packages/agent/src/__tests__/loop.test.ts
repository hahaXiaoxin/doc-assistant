/**
 * 单测：Agent tool-calling loop
 * ---------------------------------------------
 * 用假的 LLMProvider + 假 tool 验证：
 * - 无 tool-call 时一轮结束
 * - 有 tool-call 时执行 tool，把结果回灌，进入下一轮
 * - maxTurns 生效
 * - 未注册 tool 返回 isError
 * - tool 抛异常被捕获为 isError
 */
import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../loop';
import type {
  ChatChunk,
  ChatMessage,
  ToolDefinition,
} from '@doc-assistant/shared';
import type { LLMProvider, ModelInfo, ChatParams } from '@doc-assistant/provider';

function makeFakeProvider(
  responses: ChatChunk[][],
): LLMProvider {
  let call = 0;
  return {
    getModelInfo(): ModelInfo {
      return {
        id: 'fake',
        contextWindow: 8192,
        supportsReasoning: false,
        supportsTools: true,
      };
    },
    // eslint-disable-next-line require-yield
    async *chat(_p: ChatParams): AsyncIterable<ChatChunk> {
      const resp = responses[call++] ?? [{ type: 'finish', finishReason: 'stop' } as const];
      for (const c of resp) yield c;
    },
  };
}

const dummyTool: ToolDefinition = {
  name: 'echo',
  description: 'echo',
  parametersJsonSchema: { type: 'object', properties: {}, required: [] },
  async execute(args) {
    return { echoed: args };
  },
};

const errorTool: ToolDefinition = {
  name: 'boom',
  description: 'always throw',
  parametersJsonSchema: { type: 'object', properties: {}, required: [] },
  async execute() {
    throw new Error('boom!');
  },
};

describe('runAgentLoop', () => {
  it('无 tool-call 时一轮结束', async () => {
    const llm = makeFakeProvider([
      [
        { type: 'text-delta', delta: 'hello' },
        { type: 'finish', finishReason: 'stop' },
      ],
    ]);
    const chunks: ChatChunk[] = [];
    for await (const c of runAgentLoop({
      llm,
      messages: [{ role: 'user', content: 'hi' } as ChatMessage],
      tools: [dummyTool],
      toolExecCtx: {},
    })) {
      chunks.push(c);
    }
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true);
    expect(chunks[chunks.length - 1]).toMatchObject({ type: 'finish' });
  });

  it('tool-call 被执行并回灌，产出 tool-result', async () => {
    const llm = makeFakeProvider([
      [
        {
          type: 'tool-call',
          call: { id: 'c1', name: 'echo', args: { x: 1 } },
        },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text-delta', delta: 'done' },
        { type: 'finish', finishReason: 'stop' },
      ],
    ]);
    const chunks: ChatChunk[] = [];
    for await (const c of runAgentLoop({
      llm,
      messages: [{ role: 'user', content: 'call echo' } as ChatMessage],
      tools: [dummyTool],
      toolExecCtx: {},
    })) {
      chunks.push(c);
    }
    const toolResult = chunks.find((c) => c.type === 'tool-result');
    expect(toolResult).toBeDefined();
    if (toolResult && toolResult.type === 'tool-result') {
      expect(toolResult.result.name).toBe('echo');
      expect(toolResult.result.isError).toBeFalsy();
    }
  });

  it('未注册的 tool 返回 isError=true', async () => {
    const llm = makeFakeProvider([
      [
        {
          type: 'tool-call',
          call: { id: 'c1', name: 'nonexistent', args: {} },
        },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
      [{ type: 'finish', finishReason: 'stop' }],
    ]);
    const chunks: ChatChunk[] = [];
    for await (const c of runAgentLoop({
      llm,
      messages: [{ role: 'user', content: 'x' } as ChatMessage],
      tools: [dummyTool],
      toolExecCtx: {},
    })) {
      chunks.push(c);
    }
    const toolResult = chunks.find(
      (c): c is Extract<ChatChunk, { type: 'tool-result' }> => c.type === 'tool-result',
    );
    expect(toolResult?.result.isError).toBe(true);
  });

  it('tool 抛异常被捕获为 isError', async () => {
    const llm = makeFakeProvider([
      [
        {
          type: 'tool-call',
          call: { id: 'c1', name: 'boom', args: {} },
        },
        { type: 'finish', finishReason: 'tool_calls' },
      ],
      [{ type: 'finish', finishReason: 'stop' }],
    ]);
    const chunks: ChatChunk[] = [];
    for await (const c of runAgentLoop({
      llm,
      messages: [{ role: 'user', content: 'x' } as ChatMessage],
      tools: [errorTool],
      toolExecCtx: {},
    })) {
      chunks.push(c);
    }
    const tr = chunks.find(
      (c): c is Extract<ChatChunk, { type: 'tool-result' }> => c.type === 'tool-result',
    );
    expect(tr?.result.isError).toBe(true);
    expect(String(tr?.result.result)).toContain('boom');
  });

  it('maxTurns 限制生效', async () => {
    // 永远 tool-call 的 LLM
    const llm: LLMProvider = {
      getModelInfo: () => ({
        id: 'fake',
        contextWindow: 1024,
        supportsReasoning: false,
        supportsTools: true,
      }),
      async *chat() {
        yield {
          type: 'tool-call',
          call: { id: `c${Math.random()}`, name: 'echo', args: {} },
        } as ChatChunk;
        yield { type: 'finish', finishReason: 'tool_calls' } as ChatChunk;
      },
    };
    const chunks: ChatChunk[] = [];
    for await (const c of runAgentLoop({
      llm,
      messages: [{ role: 'user', content: 'loop' } as ChatMessage],
      tools: [dummyTool],
      toolExecCtx: {},
      maxTurns: 2,
    })) {
      chunks.push(c);
    }
    // 最后一条应为 length finish（强制停止）
    expect(chunks[chunks.length - 1]).toMatchObject({
      type: 'finish',
      finishReason: 'length',
    });
  });

  it('v0.2 兜底：最后一轮不传 tools（ChatParams 里无 tools 字段）', async () => {
    const capturedParams: ChatParams[] = [];
    const llm: LLMProvider = {
      getModelInfo: () => ({
        id: 'fake',
        contextWindow: 1024,
        supportsReasoning: false,
        supportsTools: true,
      }),
      async *chat(p: ChatParams) {
        capturedParams.push(p);
        const turnIdx = capturedParams.length - 1;
        // 第 0 轮 LLM 返回 tool-call；之后轮次返回文字
        if (turnIdx === 0) {
          yield {
            type: 'tool-call',
            call: { id: 'c1', name: 'echo', args: { x: 1 } },
          } as ChatChunk;
          yield { type: 'finish', finishReason: 'tool_calls' } as ChatChunk;
        } else {
          yield { type: 'text-delta', delta: '最终回答' } as ChatChunk;
          yield { type: 'finish', finishReason: 'stop' } as ChatChunk;
        }
      },
    };
    const chunks: ChatChunk[] = [];
    for await (const c of runAgentLoop({
      llm,
      messages: [{ role: 'user', content: 'hi' } as ChatMessage],
      tools: [dummyTool],
      toolExecCtx: {},
      maxTurns: 2,
    })) {
      chunks.push(c);
    }
    // 第 0 轮调用带 tools；第 1 轮（最后一轮）不带 tools
    expect(capturedParams[0]?.tools).toBeDefined();
    expect(capturedParams[0]?.tools?.length).toBeGreaterThan(0);
    expect(capturedParams[1]?.tools).toBeUndefined();
    // 最后一轮 messages 末尾有追加的 system 提醒
    const lastTurnMessages = capturedParams[1]?.messages ?? [];
    const tail = lastTurnMessages[lastTurnMessages.length - 1];
    expect(tail?.role).toBe('system');
    expect(String(tail?.content)).toContain('工具调用上限');
    // 有文字输出
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true);
  });

  it('v0.2 兜底：最后一轮收到 tool-call 被忽略（不 yield 不执行）', async () => {
    const llm: LLMProvider = {
      getModelInfo: () => ({
        id: 'fake',
        contextWindow: 1024,
        supportsReasoning: false,
        supportsTools: true,
      }),
      async *chat() {
        // 无论第几轮都返回 tool-call 违反指令
        yield {
          type: 'tool-call',
          call: { id: `c${Math.random()}`, name: 'echo', args: {} },
        } as ChatChunk;
        yield { type: 'finish', finishReason: 'tool_calls' } as ChatChunk;
      },
    };
    const chunks: ChatChunk[] = [];
    for await (const c of runAgentLoop({
      llm,
      messages: [{ role: 'user', content: 'x' } as ChatMessage],
      tools: [dummyTool],
      toolExecCtx: {},
      maxTurns: 2,
    })) {
      chunks.push(c);
    }
    // 第 0 轮正常：yield 一个 tool-call + 一个 tool-result
    const toolCalls = chunks.filter((c) => c.type === 'tool-call');
    const toolResults = chunks.filter((c) => c.type === 'tool-result');
    expect(toolCalls.length).toBe(1); // 只有第 0 轮的 tool-call 被 yield
    expect(toolResults.length).toBe(1); // 只有第 0 轮的 tool-result
    // 最后一条是 finish: length（最后一轮 LLM 仍违反指令 → 没有 text，finishReason=tool_calls 被改写为 length）
    expect(chunks[chunks.length - 1]).toMatchObject({
      type: 'finish',
      finishReason: 'length',
    });
  });

  it('v0.2 兜底：最后一轮无任何输出 → finish:error + "网络不佳"错误', async () => {
    let callCount = 0;
    const llm: LLMProvider = {
      getModelInfo: () => ({
        id: 'fake',
        contextWindow: 1024,
        supportsReasoning: false,
        supportsTools: true,
      }),
      // eslint-disable-next-line require-yield
      async *chat() {
        callCount += 1;
        if (callCount === 1) {
          // 第 0 轮正常 tool-call
          yield {
            type: 'tool-call',
            call: { id: 'c1', name: 'echo', args: {} },
          } as ChatChunk;
          yield { type: 'finish', finishReason: 'tool_calls' } as ChatChunk;
        }
        // 最后一轮完全不 yield（模拟网络异常 / 空响应）
      },
    };
    const chunks: ChatChunk[] = [];
    for await (const c of runAgentLoop({
      llm,
      messages: [{ role: 'user', content: 'x' } as ChatMessage],
      tools: [dummyTool],
      toolExecCtx: {},
      maxTurns: 2,
    })) {
      chunks.push(c);
    }
    // 期望有一个 error chunk 携带"网络不佳"信息
    const errorChunk = chunks.find(
      (c): c is Extract<ChatChunk, { type: 'error' }> => c.type === 'error',
    );
    expect(errorChunk).toBeDefined();
    expect(String(errorChunk?.error.message)).toContain('网络不佳');
    // 最后一条是 finish:error
    expect(chunks[chunks.length - 1]).toMatchObject({
      type: 'finish',
      finishReason: 'error',
    });
  });
});
