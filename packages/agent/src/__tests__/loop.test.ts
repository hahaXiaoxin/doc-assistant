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
});
