/**
 * 单测：AI SDK stream part → ChatChunk 归一化
 * ---------------------------------------------
 * 覆盖：text-delta / reasoning / tool-call / tool-result / finish(各类 reason) / error /
 * 未知 part 的忽略
 */
import { describe, expect, it } from 'vitest';
import { normalizeStreamPart } from '../qwen/normalizer';

describe('normalizeStreamPart', () => {
  it('text-delta 映射为 text-delta', () => {
    expect(normalizeStreamPart({ type: 'text-delta', textDelta: 'hello' })).toEqual([
      { type: 'text-delta', delta: 'hello' },
    ]);
  });

  it('空 text-delta 返回空数组', () => {
    expect(normalizeStreamPart({ type: 'text-delta', textDelta: '' })).toEqual([]);
  });

  it('reasoning part 映射为 reasoning-delta', () => {
    expect(normalizeStreamPart({ type: 'reasoning', textDelta: '思考中' })).toEqual([
      { type: 'reasoning-delta', delta: '思考中' },
    ]);
    expect(normalizeStreamPart({ type: 'reasoning-delta', textDelta: 'a' })).toEqual([
      { type: 'reasoning-delta', delta: 'a' },
    ]);
  });

  it('reasoning-signature 被忽略', () => {
    expect(normalizeStreamPart({ type: 'reasoning-signature', sig: 'xxx' })).toEqual([]);
  });

  it('tool-call 映射为 tool-call', () => {
    const chunks = normalizeStreamPart({
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'read_page_content',
      args: { q: 'hi' },
    });
    expect(chunks).toEqual([
      {
        type: 'tool-call',
        call: { id: 'call_1', name: 'read_page_content', args: { q: 'hi' } },
      },
    ]);
  });

  it('缺少 id 或 name 的 tool-call 被忽略', () => {
    expect(normalizeStreamPart({ type: 'tool-call', toolCallId: '', toolName: 'x' })).toEqual([]);
    expect(normalizeStreamPart({ type: 'tool-call', toolCallId: 'a' })).toEqual([]);
  });

  it('tool-result 映射保留 isError', () => {
    expect(
      normalizeStreamPart({
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 't',
        result: { ok: true },
        isError: false,
      }),
    ).toEqual([
      {
        type: 'tool-result',
        result: { toolCallId: 'c1', name: 't', result: { ok: true }, isError: false },
      },
    ]);
  });

  it('finish(stop) 映射 finishReason=stop 并保留 usage', () => {
    const chunks = normalizeStreamPart({
      type: 'finish',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, reasoningTokens: 3 },
    });
    expect(chunks).toEqual([
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, reasoningTokens: 3 },
      },
    ]);
  });

  it.each([
    ['tool-calls', 'tool_calls'],
    ['tool_calls', 'tool_calls'],
    ['length', 'length'],
    ['content-filter', 'content_filter'],
    ['aborted', 'abort'],
    ['error', 'error'],
    ['unknown_reason', 'other'],
  ])('finishReason %s → %s', (raw, expected) => {
    const chunks = normalizeStreamPart({ type: 'finish', finishReason: raw });
    expect(chunks[0]).toMatchObject({ type: 'finish', finishReason: expected });
  });

  it('error part 映射并包裹成 Error 实例', () => {
    const chunks = normalizeStreamPart({ type: 'error', error: 'boom' });
    expect(chunks).toHaveLength(1);
    const first = chunks[0]!;
    expect(first.type).toBe('error');
    if (first.type === 'error') {
      expect(first.error).toBeInstanceOf(Error);
      expect(first.error.message).toBe('boom');
    }
  });

  it('未知类型被忽略', () => {
    expect(normalizeStreamPart({ type: 'some-future-part', foo: 1 })).toEqual([]);
  });

  it('step-start / step-finish 等元 part 被忽略', () => {
    expect(normalizeStreamPart({ type: 'step-start' })).toEqual([]);
    expect(normalizeStreamPart({ type: 'step-finish' })).toEqual([]);
  });
});
