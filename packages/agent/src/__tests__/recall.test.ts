/**
 * 单测：召回链路（recall-triggers / recallMemory / RelevantMemorySource）
 */
import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider, ChatParams, ModelInfo } from '@doc-assistant/provider';
import {
  NullMemoryStore,
  type MemoryStore,
  type MemoryRecord,
  type RecallQuery,
} from '@doc-assistant/memory';
import type { ChatChunk } from '@doc-assistant/shared';
import {
  detectRecallTrigger,
  buildRecentHistoryHint,
  recallMemory,
  createRelevantMemorySource,
  renderRecallMatches,
  type AgentInvokeContext,
} from '../context';

/* ------------------------------------------------------------------ */
/* fake aux + memory                                                   */
/* ------------------------------------------------------------------ */

function makeStream(chunks: ChatChunk[]): AsyncIterable<ChatChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) {
        await Promise.resolve();
        yield c;
      }
    },
  };
}

function fakeAux(chunks: ChatChunk[]): LLMProvider & { calls: ChatParams[] } {
  const calls: ChatParams[] = [];
  return {
    calls,
    getModelInfo(): ModelInfo {
      return {
        id: 'fake',
        contextWindow: 8000,
        supportsReasoning: false,
        supportsTools: false,
      };
    },
    chat(params) {
      calls.push(params);
      return makeStream(chunks);
    },
  };
}

function makeMemory(opts: {
  visitSummaries?: MemoryRecord[];
  episodes?: MemoryRecord[];
} = {}): MemoryStore {
  const vs = opts.visitSummaries ?? [];
  const eps = opts.episodes ?? [];
  const base = new NullMemoryStore();
  return Object.assign(base, {
    async remember() {},
    async recall(q: RecallQuery) {
      if (q.types?.includes('visit_summary')) return vs;
      return eps;
    },
  });
}

/* ------------------------------------------------------------------ */
/* detectRecallTrigger                                                 */
/* ------------------------------------------------------------------ */

describe('detectRecallTrigger', () => {
  it('中文时间线索命中', () => {
    const r = detectRecallTrigger('上次你提到的那个 agent loop 怎么改？');
    expect(r.hit).toBe(true);
    expect(r.matchedText).toContain('上次');
  });

  it('中文记忆线索命中', () => {
    expect(detectRecallTrigger('还记得我们聊过 Dexie 吗？').hit).toBe(true);
    expect(detectRecallTrigger('你之前说过 context source 怎么排序？').hit).toBe(true);
  });

  it('英文关键词命中', () => {
    expect(detectRecallTrigger('Do you remember the agent loop?').hit).toBe(true);
    expect(detectRecallTrigger('Last time we discussed the schema').hit).toBe(true);
  });

  it('空白或纯标点 → false', () => {
    expect(detectRecallTrigger('  ').hit).toBe(false);
    expect(detectRecallTrigger('???').hit).toBe(false);
  });

  it('普通提问不误报', () => {
    expect(detectRecallTrigger('什么是 Dexie？').hit).toBe(false);
    expect(detectRecallTrigger('How does cosine similarity work?').hit).toBe(false);
  });
});

describe('buildRecentHistoryHint', () => {
  it('取末尾 maxTurns*2 条并截断', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg ${i} ` + 'x'.repeat(300),
    }));
    const hint = buildRecentHistoryHint(history, 2);
    const lines = hint.split('\n');
    expect(lines.length).toBe(4);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(150); // 100 字正文 + 前缀
  });
});

/* ------------------------------------------------------------------ */
/* recallMemory                                                        */
/* ------------------------------------------------------------------ */

describe('recallMemory · auto 模式', () => {
  it('粗判未命中 → stage=keyword_miss，不查 memory', async () => {
    const mem = makeMemory();
    const spy = vi.spyOn(mem, 'recall');
    const r = await recallMemory({ memory: mem }, { query: '什么是 Dexie？' });
    expect(r.hit).toBe(false);
    expect(r.stage).toBe('keyword_miss');
    expect(spy).not.toHaveBeenCalled();
  });

  it('粗判命中 + aux 判 no → stage=intent_no', async () => {
    const aux = fakeAux([
      { type: 'text-delta', delta: 'ANSWER: no\nCONFIDENCE: 0.9' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const mem = makeMemory();
    const spy = vi.spyOn(mem, 'recall');
    const r = await recallMemory(
      { memory: mem, aux },
      { query: '上次那个天气真好' },
    );
    expect(r.hit).toBe(false);
    expect(r.stage).toBe('intent_no');
    expect(spy).not.toHaveBeenCalled();
  });

  it('粗判 + aux 判 yes + 无候选 → stage=empty_result', async () => {
    const aux = fakeAux([
      { type: 'text-delta', delta: 'ANSWER: yes\nCONFIDENCE: 0.8' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const mem = makeMemory({ visitSummaries: [] });
    const r = await recallMemory(
      { memory: mem, aux },
      { query: '还记得上次 agent loop' },
    );
    expect(r.hit).toBe(false);
    expect(r.stage).toBe('empty_result');
  });

  it('粗判 + aux 判 yes + 有候选 → stage=success 并带邻居', async () => {
    const aux = fakeAux([
      { type: 'text-delta', delta: 'ANSWER: yes' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const mem = makeMemory({
      visitSummaries: [
        {
          id: 's1',
          type: 'visit_summary',
          content: '讨论了 agent loop 的兜底',
          timestamp: 1,
          visitId: 'v1',
          topic: ['agent', 'loop'],
        },
      ],
      episodes: [
        {
          id: 'm1',
          type: 'message',
          content: '最后一轮要不要传 tools',
          timestamp: 2,
          visitId: 'v1',
          orderInVisit: 0,
          role: 'user',
        },
        {
          id: 'm2',
          type: 'message',
          content: '不传，避免死循环',
          timestamp: 3,
          visitId: 'v1',
          orderInVisit: 1,
          role: 'assistant',
        },
      ],
    });
    const r = await recallMemory(
      { memory: mem, aux },
      { query: '还记得我们讨论的 agent loop 吗？', limit: 5 },
    );
    expect(r.hit).toBe(true);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.summary.content).toContain('agent loop');
    expect(r.matches[0]!.neighbors.length).toBeGreaterThanOrEqual(1);
  });
});

describe('recallMemory · explicit 模式', () => {
  it('绕过粗判 + aux，直接查 memory', async () => {
    const mem = makeMemory({
      visitSummaries: [
        {
          id: 's1',
          type: 'visit_summary',
          content: 'React Hooks',
          timestamp: 1,
          visitId: 'v1',
        },
      ],
    });
    // 即便 query 没有"上次"关键词，explicit 模式也会召回
    const r = await recallMemory(
      { memory: mem },
      { query: 'Hooks', mode: 'explicit' },
    );
    expect(r.hit).toBe(true);
    expect(r.matches).toHaveLength(1);
  });
});

describe('recallMemory · 错误路径', () => {
  it('memory.recall 抛错 → stage=error', async () => {
    const mem: MemoryStore = Object.assign(new NullMemoryStore(), {
      async recall(): Promise<never> {
        throw new Error('boom');
      },
    });
    const r = await recallMemory({ memory: mem }, { query: 'x', mode: 'explicit' });
    expect(r.hit).toBe(false);
    expect(r.stage).toBe('error');
    expect(r.error).toContain('boom');
  });
});

describe('recallMemory · v0.4.0 扩参', () => {
  it('传 timeRange 透传到 memory.recall 的 timeRange 过滤', async () => {
    const calls: RecallQuery[] = [];
    const NOW = new Date(2026, 3, 29, 15, 0, 0).getTime();
    const mem = Object.assign(new NullMemoryStore(), {
      async recall(q: RecallQuery): Promise<MemoryRecord[]> {
        calls.push(q);
        return [];
      },
    });
    await recallMemory(
      { memory: mem },
      {
        query: 'hooks',
        mode: 'explicit',
        timeRange: 'today',
        getNow: () => NOW,
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.timeRange).toBeDefined();
    expect(Array.isArray(calls[0]!.timeRange)).toBe(true);
  });

  it('传 domain 透传到 memory.recall', async () => {
    const calls: RecallQuery[] = [];
    const mem = Object.assign(new NullMemoryStore(), {
      async recall(q: RecallQuery): Promise<MemoryRecord[]> {
        calls.push(q);
        return [];
      },
    });
    await recallMemory(
      { memory: mem },
      { query: 'x', mode: 'explicit', domain: 'react.dev' },
    );
    expect(calls[0]!.domain).toBe('react.dev');
  });

  it('传 articleId 透传到 memory.recall', async () => {
    const calls: RecallQuery[] = [];
    const mem = Object.assign(new NullMemoryStore(), {
      async recall(q: RecallQuery): Promise<MemoryRecord[]> {
        calls.push(q);
        return [];
      },
    });
    await recallMemory(
      { memory: mem },
      { query: 'x', mode: 'explicit', articleId: 'a1' },
    );
    expect(calls[0]!.articleId).toBe('a1');
  });

  it('custom timeRange 缺 startTs/endTs → stage=error', async () => {
    const mem = Object.assign(new NullMemoryStore(), {
      async recall(): Promise<MemoryRecord[]> {
        return [];
      },
    });
    const r = await recallMemory(
      { memory: mem },
      { query: 'x', mode: 'explicit', timeRange: 'custom' },
    );
    expect(r.hit).toBe(false);
    expect(r.stage).toBe('error');
  });
});

/* ------------------------------------------------------------------ */
/* renderRecallMatches                                                 */
/* ------------------------------------------------------------------ */

describe('renderRecallMatches', () => {
  it('多条渲染包含标签、日期、邻居', () => {
    const text = renderRecallMatches([
      {
        summary: {
          id: 's1',
          type: 'visit_summary',
          content: '讨论 agent',
          timestamp: 1700000000000,
          topic: ['agent'],
        },
        neighbors: [
          { visitId: 'v1', orderInVisit: 0, role: 'user', content: '问题 X' },
          { visitId: 'v1', orderInVisit: 10, role: 'assistant', content: '回答 Y' },
        ],
      },
    ]);
    expect(text).toContain('# 相关历史记忆');
    expect(text).toContain('讨论 agent');
    expect(text).toContain('agent');
    expect(text).toContain('用户: 问题 X');
    expect(text).toContain('助手: 回答 Y');
  });
});

/* ------------------------------------------------------------------ */
/* createRelevantMemorySource                                          */
/* ------------------------------------------------------------------ */

describe('createRelevantMemorySource', () => {
  function makeCtx(overrides: Partial<AgentInvokeContext> = {}): AgentInvokeContext {
    return {
      userInput: '',
      history: [],
      ...overrides,
    };
  }

  it('无 memory → null', async () => {
    const source = createRelevantMemorySource(null, null);
    expect(await source.gather(makeCtx({ userInput: '还记得上次' }))).toBeNull();
  });

  it('粗判未命中 → null', async () => {
    const source = createRelevantMemorySource(makeMemory(), null);
    expect(await source.gather(makeCtx({ userInput: '什么是 Dexie' }))).toBeNull();
  });

  it('命中 → 返回 system 段', async () => {
    const aux = fakeAux([
      { type: 'text-delta', delta: 'ANSWER: yes' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const mem = makeMemory({
      visitSummaries: [
        {
          id: 's1',
          type: 'visit_summary',
          content: '讨论 agent loop',
          timestamp: 1,
        },
      ],
    });
    const source = createRelevantMemorySource(mem, aux);
    const seg = await source.gather(makeCtx({ userInput: '上次聊的 agent loop 怎么改' }));
    expect(seg).not.toBeNull();
    expect(seg!.message.role).toBe('system');
    expect(seg!.message.content).toContain('agent loop');
  });

  it('enableAuxIntent=false → 粗判命中后不调 aux', async () => {
    const aux = fakeAux([]); // 不会被消费
    const mem = makeMemory({
      visitSummaries: [
        {
          id: 's1',
          type: 'visit_summary',
          content: 'React Hooks',
          timestamp: 1,
        },
      ],
    });
    const source = createRelevantMemorySource(mem, aux, { enableAuxIntent: false });
    const seg = await source.gather(makeCtx({ userInput: '还记得上次聊的' }));
    expect(seg).not.toBeNull();
    expect(aux.calls).toHaveLength(0);
  });

  it('priority=40', () => {
    const source = createRelevantMemorySource(makeMemory(), null);
    expect(source.priority).toBe(40);
    expect(source.name).toBe('relevant-memory');
  });

  /* v0.4.0 · 时间维自动路由 */
  it('时间维元查询 → 跳过 aux/向量，直接按时间窗注入 visit_summary 清单', async () => {
    const aux = fakeAux([]); // 不应被消费
    const vs = [
      {
        id: 's1',
        type: 'visit_summary' as const,
        content: '今天看的 react hooks',
        timestamp: 1,
        domain: 'react.dev',
        topic: ['react'],
      },
    ];
    const mem = Object.assign(new NullMemoryStore(), {
      async recall(q: RecallQuery): Promise<MemoryRecord[]> {
        // 必须携带 timeRange（来自 resolveTimeRange）与 types=['visit_summary']
        expect(q.types).toEqual(['visit_summary']);
        expect(Array.isArray(q.timeRange)).toBe(true);
        return vs;
      },
    });
    const source = createRelevantMemorySource(mem, aux);
    const seg = await source.gather({
      userInput: '今天看了哪些文章',
      history: [],
    });
    expect(seg).not.toBeNull();
    expect(seg!.message.role).toBe('system');
    expect(seg!.message.content).toContain('按时间窗自动召回');
    expect(seg!.message.content).toContain('react hooks');
    expect(aux.calls).toHaveLength(0); // 未触发 aux
  });

  it('时间维元查询 · 窗内无数据 → null', async () => {
    const mem = Object.assign(new NullMemoryStore(), {
      async recall(): Promise<MemoryRecord[]> {
        return [];
      },
    });
    const source = createRelevantMemorySource(mem, null);
    const seg = await source.gather({
      userInput: '今天看了哪些文章',
      history: [],
    });
    expect(seg).toBeNull();
  });

  it('非时间维查询 → 走原语义召回链路', async () => {
    // 通过 spy 断言"非时间维路径"走的是 recallMemory（semantic 非空）
    const calls: RecallQuery[] = [];
    const mem = Object.assign(new NullMemoryStore(), {
      async recall(q: RecallQuery): Promise<MemoryRecord[]> {
        calls.push(q);
        return []; // 无命中
      },
    });
    const source = createRelevantMemorySource(mem, null);
    await source.gather({
      userInput: '上次聊的 agent loop 怎么改',
      history: [],
    });
    // 语义路径：recall-triggers 粗判命中后走 memory.recall({semantic})
    // 本用例不断言命中结果（空数组），只断言**不是**时间窗分支：即 memory.recall 的调用
    // 如果有调用必然带 semantic；如果粗判 miss 则根本不调 memory.recall
    for (const q of calls) {
      expect(q.semantic).toBeTruthy();
      // 不应带预设 timeRange（因为 user 输入不是时间维）
      // 这里不强行断言 timeRange === undefined，因为 semantic 路径本身不会自动注 timeRange
    }
  });
});
