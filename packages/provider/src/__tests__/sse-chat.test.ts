/**
 * 单测：sse-chat (runOpenAIChatStream)
 * ---------------------------------------------
 * 覆盖 v0.6.0-beta.2 重构核心：从 AI SDK 切到自己解析 OpenAI 协议 SSE 流。
 *
 * 主要场景：
 * - text-delta 单条 / 多条累积
 * - reasoning-delta（DeepSeek 思考模式真实样本）
 * - reasoning + content 混合流
 * - tool_calls 累积：单个 / 多个并发（不同 index）/ arguments 跨 chunk 切割
 * - finish_reason 各种值映射 + usage 提取（含 reasoning_tokens）
 * - SSE 边界：跨 buffer 边界 / [DONE] / 空行 / 注释行 / 多行 data:
 * - 错误：4xx / 5xx / 网络错误 / 上游 SSE 错误帧 / abort
 *
 * 实现：mock global.fetch 返回带 ReadableStream<Uint8Array> 的 Response。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatChunk } from '@doc-assistant/shared';
import { createLogger } from '@doc-assistant/shared';
import {
  runOpenAIChatStream,
  normalizeFinishReason,
  extractUsage,
  type OpenAIChatRequest,
} from '../openai-compatible/sse-chat';

const logger = createLogger('test:sse-chat');

const BASE_REQ: OpenAIChatRequest = {
  model: 'deepseek-v4-pro',
  messages: [{ role: 'user', content: '你好' }],
  stream: true,
};

/**
 * 把若干 SSE 帧（字符串）拼成一个 ReadableStream<Uint8Array>。
 * - 默认每帧自动以 `\n\n` 分割
 * - 默认末尾追加 `data: [DONE]\n\n`
 */
function streamFromFrames(
  frames: string[],
  opts?: { appendDone?: boolean; chunkSize?: number },
): ReadableStream<Uint8Array> {
  const append = opts?.appendDone ?? true;
  const text = frames.map((f) => `data: ${f}\n\n`).join('') + (append ? 'data: [DONE]\n\n' : '');
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const chunkSize = opts?.chunkSize ?? bytes.length;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
}

/** 直接用裸字节流（不自动加 data: 前缀）— 用于测 SSE 边界 */
function streamFromRaw(raw: string, chunkSize?: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(raw);
  const cs = chunkSize ?? bytes.length;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += cs) {
        controller.enqueue(bytes.slice(i, i + cs));
      }
      controller.close();
    },
  });
}

function mockOk(stream: ReadableStream<Uint8Array>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body: stream,
    async text() {
      return '';
    },
  } as unknown as Response);
}

function mockHttp(status: number, bodyText: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    body: null,
    async text() {
      return bodyText;
    },
  } as unknown as Response);
}

async function collect(iter: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('runOpenAIChatStream · text-delta', () => {
  it('单条 text-delta 被透出', async () => {
    const stream = streamFromFrames([
      JSON.stringify({ choices: [{ delta: { content: 'hello' } }] }),
    ]);
    globalThis.fetch = mockOk(stream) as unknown as typeof globalThis.fetch;

    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x/v1/chat/completions', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    expect(chunks).toEqual([
      { type: 'text-delta', delta: 'hello' },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });

  it('多条 text-delta 顺序透出', async () => {
    const stream = streamFromFrames([
      JSON.stringify({ choices: [{ delta: { content: '你好' } }] }),
      JSON.stringify({ choices: [{ delta: { content: '世界' } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    ]);
    globalThis.fetch = mockOk(stream) as unknown as typeof globalThis.fetch;

    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x/v1/chat/completions', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    expect(chunks).toMatchObject([
      { type: 'text-delta', delta: '你好' },
      { type: 'text-delta', delta: '世界' },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });

  it('空 / null content 不产出 chunk', async () => {
    const stream = streamFromFrames([
      JSON.stringify({ choices: [{ delta: { content: '' } }] }),
      JSON.stringify({ choices: [{ delta: { content: null } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'a' } }] }),
    ]);
    globalThis.fetch = mockOk(stream) as unknown as typeof globalThis.fetch;

    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x/v1/chat/completions', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    const texts = chunks.filter((c) => c.type === 'text-delta');
    expect(texts).toHaveLength(1);
  });
});

describe('runOpenAIChatStream · reasoning-delta（DeepSeek 思考模式）', () => {
  it('reasoning_content 增量被识别为 reasoning-delta', async () => {
    const stream = streamFromFrames([
      JSON.stringify({ choices: [{ delta: { reasoning_content: '让我先想想' } }] }),
      JSON.stringify({ choices: [{ delta: { reasoning_content: '这道题' } }] }),
      JSON.stringify({ choices: [{ delta: { content: '答案是 42' }, finish_reason: 'stop' }] }),
    ]);
    globalThis.fetch = mockOk(stream) as unknown as typeof globalThis.fetch;

    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x/v1/chat/completions', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    const reasoning = chunks
      .filter((c) => c.type === 'reasoning-delta')
      .map((c) => (c as { delta: string }).delta)
      .join('');
    expect(reasoning).toBe('让我先想想这道题');
    const text = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => (c as { delta: string }).delta)
      .join('');
    expect(text).toBe('答案是 42');
    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: 'stop' });
  });

  it('reasoning 与 content 同帧混合（reasoning 在前）', async () => {
    const stream = streamFromFrames([
      JSON.stringify({
        choices: [{ delta: { reasoning_content: '分析:', content: '答:' } }],
      }),
    ]);
    globalThis.fetch = mockOk(stream) as unknown as typeof globalThis.fetch;

    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x/v1/chat/completions', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    expect(chunks[0]).toEqual({ type: 'text-delta', delta: '答:' });
    expect(chunks[1]).toEqual({ type: 'reasoning-delta', delta: '分析:' });
  });
});

describe('runOpenAIChatStream · tool_calls 累积', () => {
  it('单个 tool_call: id+name+arguments 跨 chunk 拼接', async () => {
    // 模拟 OpenAI 协议典型分片：第一帧带 id+name+空 args，后续只带 args 增量
    const stream = streamFromFrames([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'recall_memory', arguments: '' },
                },
              ],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] } }],
      }),
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] } }],
      }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    ]);
    globalThis.fetch = mockOk(stream) as unknown as typeof globalThis.fetch;

    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x/v1/chat/completions', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    const calls = chunks.filter((c) => c.type === 'tool-call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      type: 'tool-call',
      call: { id: 'call_1', name: 'recall_memory', args: '{"query":"hi"}' },
    });
    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: 'tool_calls' });
  });

  it('多个 tool_calls 并发（不同 index）按 index 升序 yield', async () => {
    const stream = streamFromFrames([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'a', type: 'function', function: { name: 'tool_a', arguments: '{}' } },
                { index: 1, id: 'b', type: 'function', function: { name: 'tool_b', arguments: '{}' } },
              ],
            },
          },
        ],
      }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    ]);
    globalThis.fetch = mockOk(stream) as unknown as typeof globalThis.fetch;

    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x/v1/chat/completions', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    const calls = chunks.filter((c) => c.type === 'tool-call') as Array<{
      type: 'tool-call';
      call: { id: string; name: string };
    }>;
    expect(calls.map((c) => c.call.id)).toEqual(['a', 'b']);
  });

  it('累积结果缺 id 或 name 的 tool-call 被丢弃', async () => {
    const stream = streamFromFrames([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                // 无 id
                { index: 0, type: 'function', function: { name: 't', arguments: '{}' } },
              ],
            },
          },
        ],
      }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    ]);
    globalThis.fetch = mockOk(stream) as unknown as typeof globalThis.fetch;

    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x/v1/chat/completions', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    expect(chunks.some((c) => c.type === 'tool-call')).toBe(false);
  });
});

describe('runOpenAIChatStream · finish 与 usage', () => {
  it('finish_reason=length 被映射', async () => {
    const stream = streamFromFrames([
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] }),
    ]);
    globalThis.fetch = mockOk(stream) as unknown as typeof globalThis.fetch;
    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: 'length' });
  });

  it('usage 在末尾 chunk 中被提取（含 reasoning_tokens）', async () => {
    const stream = streamFromFrames([
      JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 7,
          completion_tokens_details: { reasoning_tokens: 5 },
        },
      }),
    ]);
    globalThis.fetch = mockOk(stream) as unknown as typeof globalThis.fetch;

    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    const finish = chunks.at(-1)!;
    expect(finish).toEqual({
      type: 'finish',
      finishReason: 'stop',
      usage: { promptTokens: 12, completionTokens: 7, reasoningTokens: 5 },
    });
  });

  it('usage 在 choices 为空的尾帧被提取', async () => {
    const stream = streamFromFrames([
      JSON.stringify({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2 } }),
    ]);
    globalThis.fetch = mockOk(stream) as unknown as typeof globalThis.fetch;

    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 2 },
    });
  });
});

describe('runOpenAIChatStream · SSE 边界', () => {
  it('跨 buffer 边界（每 1 字节切）能正确解析', async () => {
    const frames = [
      JSON.stringify({ choices: [{ delta: { content: '你' } }] }),
      JSON.stringify({ choices: [{ delta: { content: '好' } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    ];
    const stream = streamFromFrames(frames, { chunkSize: 1 });
    globalThis.fetch = mockOk(stream) as unknown as typeof globalThis.fetch;

    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    const text = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => (c as { delta: string }).delta)
      .join('');
    expect(text).toBe('你好');
    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: 'stop' });
  });

  it('忽略空行 / 注释行 / 非 data 字段', async () => {
    const raw =
      ': comment line\n\n' +
      'event: ping\n\n' +
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'a' } }] })}\n\n` +
      '\n\n' +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n` +
      'data: [DONE]\n\n';
    globalThis.fetch = mockOk(streamFromRaw(raw)) as unknown as typeof globalThis.fetch;

    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    const text = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => (c as { delta: string }).delta)
      .join('');
    expect(text).toBe('a');
  });

  it('[DONE] 终止后即使还有数据也不再处理', async () => {
    const raw =
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'a' } }] })}\n\n` +
      'data: [DONE]\n\n' +
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'b' } }] })}\n\n`;
    globalThis.fetch = mockOk(streamFromRaw(raw)) as unknown as typeof globalThis.fetch;
    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    const text = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => (c as { delta: string }).delta)
      .join('');
    expect(text).toBe('a');
  });

  it('无法解析的 data 帧被静默忽略，流不中断', async () => {
    const raw =
      'data: not json\n\n' +
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n` +
      'data: [DONE]\n\n';
    globalThis.fetch = mockOk(streamFromRaw(raw)) as unknown as typeof globalThis.fetch;
    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true);
    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: 'stop' });
  });
});

describe('runOpenAIChatStream · 错误路径', () => {
  it('HTTP 401 → AUTH_ERROR 的 error+finish 对', async () => {
    globalThis.fetch = mockHttp(401, 'invalid api key') as unknown as typeof globalThis.fetch;
    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.type).toBe('error');
    expect(chunks[1]).toEqual({ type: 'finish', finishReason: 'error' });
    if (chunks[0]?.type === 'error') {
      expect((chunks[0].error as unknown as { code: string }).code).toBe('AUTH_ERROR');
    }
  });

  it('HTTP 429 → RATE_LIMITED', async () => {
    globalThis.fetch = mockHttp(429, 'rate limited') as unknown as typeof globalThis.fetch;
    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    expect(chunks[0]?.type).toBe('error');
    if (chunks[0]?.type === 'error') {
      expect((chunks[0].error as unknown as { code: string }).code).toBe('RATE_LIMITED');
    }
  });

  it('HTTP 500 → UPSTREAM_ERROR', async () => {
    globalThis.fetch = mockHttp(500, 'oops') as unknown as typeof globalThis.fetch;
    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    if (chunks[0]?.type === 'error') {
      expect((chunks[0].error as unknown as { code: string }).code).toBe('UPSTREAM_ERROR');
    }
  });

  it('网络错误 → NETWORK_ERROR', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof globalThis.fetch;
    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    expect(chunks[0]?.type).toBe('error');
    if (chunks[0]?.type === 'error') {
      expect((chunks[0].error as unknown as { code: string }).code).toBe('NETWORK_ERROR');
    }
  });

  it('AbortError on fetch → finish:abort（无 error chunk）', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    globalThis.fetch = vi.fn().mockRejectedValue(abortErr) as unknown as typeof globalThis.fetch;
    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    expect(chunks).toEqual([{ type: 'finish', finishReason: 'abort' }]);
  });

  it('SSE 中的 error 帧 → 转成 error+finish', async () => {
    const stream = streamFromFrames([
      JSON.stringify({ choices: [{ delta: { content: 'partial' } }] }),
      JSON.stringify({ error: { message: '上游异常', code: 'X' } }),
    ]);
    globalThis.fetch = mockOk(stream) as unknown as typeof globalThis.fetch;
    const chunks = await collect(
      runOpenAIChatStream({ url: 'https://x', apiKey: 'sk', body: BASE_REQ, logger }),
    );
    expect(chunks.some((c) => c.type === 'error')).toBe(true);
    expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
  });
});

describe('normalizeFinishReason 单元', () => {
  it.each([
    ['stop', 'stop'],
    ['tool-calls', 'tool_calls'],
    ['tool_calls', 'tool_calls'],
    ['length', 'length'],
    ['content_filter', 'content_filter'],
    ['content-filter', 'content_filter'],
    ['aborted', 'abort'],
    ['error', 'error'],
    ['something_unknown', 'other'],
    [undefined, 'other'],
  ])('%p → %p', (raw, expected) => {
    expect(normalizeFinishReason(raw)).toBe(expected);
  });
});

describe('extractUsage 单元', () => {
  it('OpenAI 协议字段(snake_case)', () => {
    expect(
      extractUsage({
        prompt_tokens: 1,
        completion_tokens: 2,
        completion_tokens_details: { reasoning_tokens: 3 },
      }),
    ).toEqual({ promptTokens: 1, completionTokens: 2, reasoningTokens: 3 });
  });

  it('已驼峰过的字段也兼容', () => {
    expect(extractUsage({ promptTokens: 1, completionTokens: 2, reasoningTokens: 3 })).toEqual({
      promptTokens: 1,
      completionTokens: 2,
      reasoningTokens: 3,
    });
  });

  it('空对象 / 非对象 → undefined', () => {
    expect(extractUsage({})).toBeUndefined();
    expect(extractUsage(null)).toBeUndefined();
    expect(extractUsage(undefined)).toBeUndefined();
    expect(extractUsage('x')).toBeUndefined();
  });
});
