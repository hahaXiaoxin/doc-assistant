/**
 * 单测：aux 模块（collectText / callAuxIntent / identifySessionTopic）
 * ---------------------------------------------
 * 全部用 mock LLMProvider（AsyncIterable<ChatChunk> 生成器），不发真实 HTTP。
 */
import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider, ChatParams, ModelInfo } from '@doc-assistant/provider';
import type { ChatChunk, ChatMessage } from '@doc-assistant/shared';
import {
  AbortError,
  AgentError,
  ProviderError,
} from '@doc-assistant/shared';
import {
  collectText,
  callAuxIntent,
  parseIntentOutput,
  identifySessionTopic,
  parseSessionTopicOutput,
  shouldIdentify,
} from '../aux';

/* ------------------------------------------------------------------ */
/* Helpers：构造一个 fake LLMProvider                                  */
/* ------------------------------------------------------------------ */

function makeStream(chunks: ChatChunk[]): AsyncIterable<ChatChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) {
        // 让 await 真的发生（模拟流式），便于测 abort
        await Promise.resolve();
        yield c;
      }
    },
  };
}

function fakeProvider(
  scriptOrFn: ChatChunk[] | ((params: ChatParams) => ChatChunk[] | AsyncIterable<ChatChunk>),
): LLMProvider & { lastParams?: ChatParams } {
  const obj: LLMProvider & { lastParams?: ChatParams } = {
    getModelInfo(): ModelInfo {
      return {
        id: 'fake-aux',
        contextWindow: 8000,
        supportsReasoning: false,
        supportsTools: false,
      };
    },
    chat(params: ChatParams): AsyncIterable<ChatChunk> {
      obj.lastParams = params;
      const script = typeof scriptOrFn === 'function' ? scriptOrFn(params) : scriptOrFn;
      return Array.isArray(script) ? makeStream(script) : script;
    },
  };
  return obj;
}

/* ------------------------------------------------------------------ */
/* collectText                                                         */
/* ------------------------------------------------------------------ */

describe('collectText', () => {
  it('聚合 text-delta 并在 finish 停止', async () => {
    const stream = makeStream([
      { type: 'text-delta', delta: 'hello' },
      { type: 'text-delta', delta: ' world' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const text = await collectText(stream);
    expect(text).toBe('hello world');
  });

  it('忽略 reasoning-delta 与 tool-call', async () => {
    const stream = makeStream([
      { type: 'reasoning-delta', delta: '思考' },
      { type: 'text-delta', delta: 'answer' },
      { type: 'tool-call', call: { id: 't1', name: 'x', args: {} } },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const text = await collectText(stream);
    expect(text).toBe('answer');
  });

  it('maxChars 截断（立即结束不抛错）', async () => {
    const stream = makeStream([
      { type: 'text-delta', delta: 'aaaaaaaaaa' }, // 10 chars
      { type: 'text-delta', delta: 'bbbb' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const text = await collectText(stream, { maxChars: 8 });
    expect(text.length).toBeGreaterThanOrEqual(8);
    expect(text.startsWith('aaaa')).toBe(true);
  });

  it('finishReason=abort 抛 AbortError', async () => {
    const stream = makeStream([
      { type: 'text-delta', delta: 'x' },
      { type: 'finish', finishReason: 'abort' },
    ]);
    await expect(collectText(stream)).rejects.toBeInstanceOf(AbortError);
  });

  it('finishReason=error 抛 ProviderError(NETWORK_ERROR)', async () => {
    const stream = makeStream([{ type: 'finish', finishReason: 'error' }]);
    try {
      await collectText(stream);
      expect.fail('应抛错');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe('NETWORK_ERROR');
    }
  });

  it('error chunk 直接抛出', async () => {
    const err = new Error('boom');
    const stream = makeStream([{ type: 'error', error: err }]);
    await expect(collectText(stream)).rejects.toThrow(/boom/);
  });

  it('空响应抛 AgentError(AUX_EMPTY_RESPONSE)', async () => {
    const stream = makeStream([{ type: 'finish', finishReason: 'stop' }]);
    try {
      await collectText(stream);
      expect.fail('应抛错');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('AUX_EMPTY_RESPONSE');
    }
  });

  it('外部 signal abort → AbortError', async () => {
    const controller = new AbortController();
    const stream: AsyncIterable<ChatChunk> = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'text-delta', delta: 'a' };
        await new Promise((r) => setTimeout(r, 0));
        controller.abort();
        yield { type: 'text-delta', delta: 'b' };
      },
    };
    await expect(collectText(stream, { signal: controller.signal })).rejects.toBeInstanceOf(
      AbortError,
    );
  });
});

/* ------------------------------------------------------------------ */
/* parseIntentOutput                                                   */
/* ------------------------------------------------------------------ */

describe('parseIntentOutput', () => {
  it('解析标准格式', () => {
    const r = parseIntentOutput('ANSWER: yes\nCONFIDENCE: 0.9');
    expect(r.intent).toBe('yes');
    expect(r.confidence).toBeCloseTo(0.9);
  });

  it('仅 yes/no 也能识别', () => {
    expect(parseIntentOutput('no').intent).toBe('no');
    expect(parseIntentOutput('yes, I think so').intent).toBe('yes');
  });

  it('置信度越界/非法 → 回退 0.5', () => {
    expect(parseIntentOutput('ANSWER: yes\nCONFIDENCE: 2.0').confidence).toBe(0.5);
    expect(parseIntentOutput('ANSWER: no\nCONFIDENCE: abc').confidence).toBe(0.5);
  });

  it('都没匹配到 → no/0.5', () => {
    const r = parseIntentOutput('whatever');
    expect(r.intent).toBe('no');
    expect(r.confidence).toBe(0.5);
  });
});

/* ------------------------------------------------------------------ */
/* callAuxIntent                                                       */
/* ------------------------------------------------------------------ */

describe('callAuxIntent', () => {
  it('正常返回解析后的结果', async () => {
    const aux = fakeProvider([
      { type: 'text-delta', delta: 'ANSWER: yes\nCONFIDENCE: 0.8' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const r = await callAuxIntent(aux, { userMessage: '还记得上次我们聊的那个吗？' });
    expect(r.intent).toBe('yes');
    expect(r.confidence).toBeCloseTo(0.8);
    // temperature 传 0
    expect(aux.lastParams?.temperature).toBe(0);
  });

  it('空消息直接返回 no/0', async () => {
    const aux = fakeProvider([]);
    const r = await callAuxIntent(aux, { userMessage: '  ' });
    expect(r.intent).toBe('no');
    expect(r.confidence).toBe(0);
  });

  it('Provider 抛错时降级为 no/0，不抛到调用方', async () => {
    const aux: LLMProvider = {
      getModelInfo: () => ({
        id: 'x',
        contextWindow: 1000,
        supportsReasoning: false,
        supportsTools: false,
      }),
      chat() {
        throw new Error('boom');
      },
    };
    const r = await callAuxIntent(aux, { userMessage: '上次的代码怎么改' });
    expect(r.intent).toBe('no');
    expect(r.confidence).toBe(0);
  });

  it('history hint 会拼入 user 消息', async () => {
    const aux = fakeProvider([
      { type: 'text-delta', delta: 'ANSWER: no' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    await callAuxIntent(aux, {
      userMessage: '继续',
      recentHistoryHint: '用户: 上次聊的...\n助手: 是的',
    });
    const lastMsg = aux.lastParams?.messages.at(-1) as ChatMessage;
    expect(lastMsg.content).toContain('最近几轮对话');
    expect(lastMsg.content).toContain('继续');
  });
});

/* ------------------------------------------------------------------ */
/* shouldIdentify                                                      */
/* ------------------------------------------------------------------ */

describe('shouldIdentify', () => {
  it('首条 user 消息触发', () => {
    expect(shouldIdentify(1)).toBe(true);
  });
  it('每 interval 条触发', () => {
    expect(shouldIdentify(4)).toBe(true);
    expect(shouldIdentify(8)).toBe(true);
  });
  it('非触发点不识别', () => {
    expect(shouldIdentify(2)).toBe(false);
    expect(shouldIdentify(3)).toBe(false);
    expect(shouldIdentify(5)).toBe(false);
  });
  it('0 条不识别', () => {
    expect(shouldIdentify(0)).toBe(false);
  });
  it('自定义 interval', () => {
    expect(shouldIdentify(3, 3)).toBe(true);
    expect(shouldIdentify(2, 3)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* parseSessionTopicOutput                                             */
/* ------------------------------------------------------------------ */

describe('parseSessionTopicOutput', () => {
  it('解析 JSON 格式', () => {
    const p = parseSessionTopicOutput(
      '{"currentTopic":"React Hooks 实现","tags":["react","hooks"],"stage":"questioning"}',
    );
    expect(p?.currentTopic).toBe('React Hooks 实现');
    expect(p?.tags).toEqual(['react', 'hooks']);
    expect(p?.stage).toBe('questioning');
  });

  it('容忍前后垃圾字符', () => {
    const p = parseSessionTopicOutput(
      '好的：{"currentTopic":"向量索引","tags":["vector","index"]}。',
    );
    expect(p?.currentTopic).toBe('向量索引');
  });

  it('非法 stage 被忽略', () => {
    const p = parseSessionTopicOutput('{"currentTopic":"x","tags":[],"stage":"weird"}');
    expect(p?.stage).toBeUndefined();
  });

  it('行扫描回退', () => {
    const p = parseSessionTopicOutput('TOPIC: 异步调度器\nTAGS: 调度,async,队列\nSTAGE: exploring');
    expect(p?.currentTopic).toBe('异步调度器');
    expect(p?.tags).toEqual(['调度', 'async', '队列']);
    expect(p?.stage).toBe('exploring');
  });

  it('空 topic 返回 null', () => {
    expect(parseSessionTopicOutput('{}')).toBeNull();
    expect(parseSessionTopicOutput('nothing')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* identifySessionTopic                                                */
/* ------------------------------------------------------------------ */

describe('identifySessionTopic', () => {
  function makeMemory() {
    const store: Record<string, unknown> = {};
    return {
      setSessionTopic: vi.fn().mockImplementation(async (rec: { visitId: string }) => {
        store[rec.visitId] = rec;
      }),
      getSessionTopic: vi.fn().mockImplementation(async (id: string) => store[id] ?? null),
      _store: store,
    };
  }

  it('成功写入并累积 history', async () => {
    const aux = fakeProvider([
      {
        type: 'text-delta',
        delta: '{"currentTopic":"Agent Loop","tags":["agent","loop"],"stage":"exploring"}',
      },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const memory = makeMemory();
    const now = 1_700_000_000_000;

    const r1 = await identifySessionTopic({
      aux,
      memory: memory as never,
      visitId: 'v1',
      canonicalUrl: 'https://x/y',
      recentMessages: [
        { role: 'user', content: '聊聊 agent loop' },
        { role: 'assistant', content: '好的…' },
      ],
      getNow: () => now,
    });

    expect(r1.status).toBe('written');
    expect(r1.record?.currentTopic).toBe('Agent Loop');
    expect(memory.setSessionTopic).toHaveBeenCalledTimes(1);

    // 再触发一次 → history 长度应累加
    const r2 = await identifySessionTopic({
      aux: fakeProvider([
        { type: 'text-delta', delta: '{"currentTopic":"Recall 链","tags":["recall"]}' },
        { type: 'finish', finishReason: 'stop' },
      ]),
      memory: memory as never,
      visitId: 'v1',
      recentMessages: [{ role: 'user', content: '再聊召回' }],
      getNow: () => now + 1000,
    });
    expect(r2.status).toBe('written');
    expect(r2.record?.history.length).toBe(2);
    expect(r2.record?.canonicalUrl).toBe('https://x/y'); // 保留首次的 canonicalUrl
  });

  it('空 topic → skipped 不写库', async () => {
    const aux = fakeProvider([
      { type: 'text-delta', delta: '{}' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const memory = makeMemory();
    const r = await identifySessionTopic({
      aux,
      memory: memory as never,
      visitId: 'v1',
      recentMessages: [{ role: 'user', content: 'x' }],
    });
    expect(r.status).toBe('skipped');
    expect(memory.setSessionTopic).not.toHaveBeenCalled();
  });

  it('Provider 抛错 → failed 不影响外部', async () => {
    const aux: LLMProvider = {
      getModelInfo: () => ({
        id: 'x',
        contextWindow: 1000,
        supportsReasoning: false,
        supportsTools: false,
      }),
      chat() {
        throw new Error('network');
      },
    };
    const memory = makeMemory();
    const r = await identifySessionTopic({
      aux,
      memory: memory as never,
      visitId: 'v1',
      recentMessages: [{ role: 'user', content: 'x' }],
    });
    expect(r.status).toBe('failed');
    expect(memory.setSessionTopic).not.toHaveBeenCalled();
  });

  it('无 recentMessages → skipped', async () => {
    const memory = makeMemory();
    const r = await identifySessionTopic({
      aux: fakeProvider([]),
      memory: memory as never,
      visitId: 'v1',
      recentMessages: [],
    });
    expect(r.status).toBe('skipped');
  });
});
