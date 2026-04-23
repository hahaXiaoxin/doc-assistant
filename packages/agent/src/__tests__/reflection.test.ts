/**
 * 单测：ReflectionRunner + ReflectionScheduler
 * ---------------------------------------------
 * - Runner: 三种任务类型的成功/失败路径 + 解析器
 * - Scheduler: runPending 的成功/失败/重试 + PageVisit 订阅登记
 * - 全部用 fake LLMProvider / EmbeddingProvider / MemoryStore（in-memory），不走真实 IDB
 */
import { describe, it, expect, vi } from 'vitest';
import type {
  LLMProvider,
  EmbeddingProvider,
  ChatParams,
  ModelInfo,
  EmbeddingInfo,
} from '@doc-assistant/provider';
import type {
  MemoryStore,
  MemoryRecord,
  PersonaRecord,
  ReflectionTask,
  ReflectionTaskType,
} from '@doc-assistant/memory';
import type { ChatChunk } from '@doc-assistant/shared';
import { PageVisitManager } from '../page-visit';
import {
  ReflectionRunner,
  ReflectionScheduler,
  parseSummaryOutput,
  parsePersonaOutput,
} from '../reflection';

/* ------------------------------------------------------------------ */
/* fake LLMProvider / EmbeddingProvider / MemoryStore                  */
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

function fakeAux(scripts: ChatChunk[][] | ChatChunk[]): LLMProvider & {
  calls: ChatParams[];
} {
  const calls: ChatParams[] = [];
  const scriptList = Array.isArray(scripts[0]) ? (scripts as ChatChunk[][]) : [scripts as ChatChunk[]];
  let i = 0;
  const obj: LLMProvider & { calls: ChatParams[] } = {
    calls,
    getModelInfo(): ModelInfo {
      return {
        id: 'fake-aux',
        contextWindow: 8000,
        supportsReasoning: false,
        supportsTools: false,
      };
    },
    chat(params: ChatParams) {
      calls.push(params);
      const s = scriptList[Math.min(i, scriptList.length - 1)] ?? [];
      i += 1;
      return makeStream(s);
    },
  };
  return obj;
}

function fakeEmbedding(): EmbeddingProvider & {
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    getEmbeddingInfo(): EmbeddingInfo {
      return { id: 'fake', dimension: 4, maxBatchSize: 25, maxInputTokens: 512 };
    },
    async embed(texts) {
      calls.push(texts);
      return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
    },
  };
}

interface FakeMemoryState {
  episodes: MemoryRecord[];
  visitSummaries: MemoryRecord[];
  personas: PersonaRecord[];
  tasks: ReflectionTask[];
}

function makeMemory(state: Partial<FakeMemoryState> = {}): MemoryStore & {
  state: FakeMemoryState;
} {
  const _state: FakeMemoryState = {
    episodes: state.episodes ?? [],
    visitSummaries: state.visitSummaries ?? [],
    personas: state.personas ?? [],
    tasks: state.tasks ?? [],
  };
  let idSeq = 0;
  const store: MemoryStore & { state: FakeMemoryState } = {
    state: _state,
    async remember(record) {
      if (record.type === 'visit_summary') _state.visitSummaries.push(record);
      else _state.episodes.push(record);
    },
    async recall(query) {
      const all =
        query.types?.includes('message') || !query.types
          ? _state.episodes
          : _state.visitSummaries;
      return all.slice(0, query.limit ?? 10);
    },
    async listPersonas({ status } = {}) {
      return status ? _state.personas.filter((p) => p.status === status) : _state.personas;
    },
    async addPersonaCandidate(c) {
      const rec: PersonaRecord = {
        id: `persona_${++idSeq}`,
        createdAt: 1,
        updatedAt: 1,
        ...c,
      };
      _state.personas.push(rec);
      return rec;
    },
    async updatePersona(id, patch) {
      const i = _state.personas.findIndex((p) => p.id === id);
      if (i < 0) return;
      _state.personas[i] = { ..._state.personas[i]!, ...patch };
    },
    async enqueueReflection(task) {
      const rec: ReflectionTask = {
        id: task.id ?? `task_${++idSeq}`,
        visitId: task.visitId,
        taskType: task.taskType,
        status: task.status ?? 'pending',
        attemptsCount: 0,
        createdAt: 1,
      };
      _state.tasks.push(rec);
      return rec;
    },
    async listPendingReflections(maxAttempts = 3) {
      return _state.tasks.filter(
        (t) => t.status === 'pending' && t.attemptsCount < maxAttempts,
      );
    },
    async updateReflection(id, patch) {
      const i = _state.tasks.findIndex((t) => t.id === id);
      if (i < 0) return;
      _state.tasks[i] = { ..._state.tasks[i]!, ...patch };
    },
  };
  return store;
}

/* ------------------------------------------------------------------ */
/* parseSummaryOutput / parsePersonaOutput                             */
/* ------------------------------------------------------------------ */

describe('parseSummaryOutput', () => {
  it('正常 JSON', () => {
    const p = parseSummaryOutput('{"summary":"聊 React","tags":["react"]}');
    expect(p?.summary).toBe('聊 React');
    expect(p?.tags).toEqual(['react']);
  });
  it('非法 JSON → 行扫描回退', () => {
    const p = parseSummaryOutput('聊了 agent loop\n然后聊 tool-calling');
    expect(p?.summary).toBe('聊了 agent loop');
    expect(p?.tags).toEqual([]);
  });
  it('空字符串 → null', () => {
    expect(parseSummaryOutput('')).toBeNull();
  });
});

describe('parsePersonaOutput', () => {
  it('解析多条候选 + 归一化 confidence', () => {
    const r = parsePersonaOutput(
      '{"candidates":[{"content":"默认使用 TypeScript 进行代码示例","confidence":0.9,"tags":["ts"]},{"content":"回答时采用前端语境举例","confidence":1.5}]}',
    );
    expect(r).toHaveLength(2);
    expect(r[0]!.tags).toEqual(['ts']);
    expect(r[1]!.confidence).toBe(1); // 归一化
  });
  it('candidates 缺失 → 空数组', () => {
    expect(parsePersonaOutput('{}')).toEqual([]);
  });
  it('非 JSON → 空数组', () => {
    expect(parsePersonaOutput('random text')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* ReflectionRunner · visit_summary                                    */
/* ------------------------------------------------------------------ */

describe('ReflectionRunner · visit_summary', () => {
  it('成功生成摘要并写入带 embedding 的 visit_summary', async () => {
    const memory = makeMemory({
      episodes: [
        {
          id: 'm1',
          type: 'message',
          content: '我在看 agent loop',
          timestamp: 1,
          visitId: 'v1',
          orderInVisit: 0,
          role: 'user',
          canonicalUrl: 'https://x/y',
          domain: 'x',
        },
        {
          id: 'm2',
          type: 'message',
          content: '好的',
          timestamp: 2,
          visitId: 'v1',
          orderInVisit: 1,
          role: 'assistant',
          canonicalUrl: 'https://x/y',
          domain: 'x',
        },
      ],
    });
    const aux = fakeAux([
      { type: 'text-delta', delta: '{"summary":"讨论 agent loop","tags":["agent","loop"]}' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const embedding = fakeEmbedding();
    const runner = new ReflectionRunner({
      memory,
      aux,
      embedding,
      getNow: () => 100,
      genId: () => 'summary_1',
    });
    const r = await runner.run({
      id: 't1',
      visitId: 'v1',
      taskType: 'visit_summary',
      status: 'pending',
      attemptsCount: 0,
      createdAt: 1,
    });
    expect(r.ok).toBe(true);
    expect(memory.state.visitSummaries).toHaveLength(1);
    const saved = memory.state.visitSummaries[0]!;
    expect(saved.content).toBe('讨论 agent loop');
    expect(saved.embedding).toBeInstanceOf(Float32Array);
    expect(saved.embedding!.length).toBe(4);
    expect(saved.canonicalUrl).toBe('https://x/y');
    expect(saved.topic).toEqual(['agent', 'loop']);
    expect(embedding.calls).toHaveLength(1);
  });

  it('无 episodes → ok:true 且 skipped', async () => {
    const memory = makeMemory();
    const runner = new ReflectionRunner({
      memory,
      aux: fakeAux([]),
      getNow: () => 100,
    });
    const r = await runner.run({
      id: 't1',
      visitId: 'vX',
      taskType: 'visit_summary',
      status: 'pending',
      attemptsCount: 0,
      createdAt: 1,
    });
    expect(r.ok).toBe(true);
    expect(memory.state.visitSummaries).toHaveLength(0);
  });

  it('aux 返回空摘要 → ok:false', async () => {
    const memory = makeMemory({
      episodes: [
        {
          id: 'm1',
          type: 'message',
          content: 'x',
          timestamp: 1,
          visitId: 'v1',
          role: 'user',
        },
      ],
    });
    const aux = fakeAux([
      { type: 'text-delta', delta: '{"summary":""}' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const runner = new ReflectionRunner({ memory, aux });
    const r = await runner.run({
      id: 't1',
      visitId: 'v1',
      taskType: 'visit_summary',
      status: 'pending',
      attemptsCount: 0,
      createdAt: 1,
    });
    expect(r.ok).toBe(false);
    expect(memory.state.visitSummaries).toHaveLength(0);
  });

  it('embedding 失败时仍落库，只是不带 vector', async () => {
    const memory = makeMemory({
      episodes: [
        {
          id: 'm1',
          type: 'message',
          content: 'x',
          timestamp: 1,
          visitId: 'v1',
          role: 'user',
        },
      ],
    });
    const aux = fakeAux([
      { type: 'text-delta', delta: '{"summary":"摘要"}' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const embedding: EmbeddingProvider = {
      getEmbeddingInfo: () => ({ id: 'fake', dimension: 4, maxBatchSize: 25, maxInputTokens: 512 }),
      async embed() {
        throw new Error('network down');
      },
    };
    const runner = new ReflectionRunner({ memory, aux, embedding });
    const r = await runner.run({
      id: 't1',
      visitId: 'v1',
      taskType: 'visit_summary',
      status: 'pending',
      attemptsCount: 0,
      createdAt: 1,
    });
    expect(r.ok).toBe(true);
    expect(memory.state.visitSummaries).toHaveLength(1);
    expect(memory.state.visitSummaries[0]!.embedding).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* ReflectionRunner · persona_extraction                               */
/* ------------------------------------------------------------------ */

describe('ReflectionRunner · persona_extraction', () => {
  it('新候选 → addPersonaCandidate', async () => {
    const memory = makeMemory({
      episodes: [
        {
          id: 'm1',
          type: 'message',
          content: '我用 TS 和 React',
          timestamp: 1,
          visitId: 'v1',
          role: 'user',
        },
      ],
    });
    const aux = fakeAux([
      {
        type: 'text-delta',
        delta: '{"candidates":[{"content":"默认使用 TypeScript 进行代码示例","confidence":0.9,"tags":["ts"]}]}',
      },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const runner = new ReflectionRunner({ memory, aux });
    const r = await runner.run({
      id: 't1',
      visitId: 'v1',
      taskType: 'persona_extraction',
      status: 'pending',
      attemptsCount: 0,
      createdAt: 1,
    });
    expect(r.ok).toBe(true);
    expect(memory.state.personas).toHaveLength(1);
    expect(memory.state.personas[0]!.status).toBe('pending');
    expect(memory.state.personas[0]!.confidence).toBeCloseTo(0.9);
  });

  it('重复候选 → dedupe 并 hitCount++', async () => {
    const memory = makeMemory({
      personas: [
        {
          id: 'exist',
          content: '默认使用 TypeScript 进行代码示例',
          status: 'pending',
          confidence: 0.6,
          hitCount: 1,
          reviewedByUser: false,
          createdAt: 1,
          updatedAt: 1,
          source: { visitId: 'v0', extractedBy: 'reflection' },
        },
      ],
      episodes: [
        {
          id: 'm1',
          type: 'message',
          content: '我还是爱用 TS',
          timestamp: 1,
          visitId: 'v1',
          role: 'user',
        },
      ],
    });
    const aux = fakeAux([
      {
        type: 'text-delta',
        delta: '{"candidates":[{"content":"默认使用 TypeScript 进行代码示例","confidence":0.95}]}',
      },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const runner = new ReflectionRunner({ memory, aux });
    const r = await runner.run({
      id: 't1',
      visitId: 'v1',
      taskType: 'persona_extraction',
      status: 'pending',
      attemptsCount: 0,
      createdAt: 1,
    });
    expect(r.ok).toBe(true);
    expect(memory.state.personas).toHaveLength(1);
    expect(memory.state.personas[0]!.hitCount).toBe(2);
    expect(memory.state.personas[0]!.confidence).toBeCloseTo(0.95);
  });

  it('memory 不支持 addPersonaCandidate → skipped', async () => {
    const partial: MemoryStore = {
      async remember() {},
      async recall() {
        return [];
      },
    };
    const runner = new ReflectionRunner({ memory: partial, aux: fakeAux([]) });
    const r = await runner.run({
      id: 't1',
      visitId: 'v1',
      taskType: 'persona_extraction',
      status: 'pending',
      attemptsCount: 0,
      createdAt: 1,
    });
    expect(r.ok).toBe(true);
    expect((r as { detail?: { skipped?: boolean } }).detail?.skipped).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* ReflectionRunner · persona_conflict_check 占位                      */
/* ------------------------------------------------------------------ */

describe('ReflectionRunner · persona_conflict_check (占位)', () => {
  it('返回 ok:true skipped', async () => {
    const runner = new ReflectionRunner({ memory: makeMemory(), aux: fakeAux([]) });
    const r = await runner.run({
      id: 't1',
      visitId: 'v1',
      taskType: 'persona_conflict_check',
      status: 'pending',
      attemptsCount: 0,
      createdAt: 1,
    });
    expect(r.ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* ReflectionScheduler                                                 */
/* ------------------------------------------------------------------ */

describe('ReflectionScheduler · runPending', () => {
  function makeRunnerMock(
    sequenceResultForTaskType: (t: ReflectionTaskType) => {
      ok: boolean;
      error?: string;
    },
  ): ReflectionRunner {
    return {
      run: vi.fn().mockImplementation(async (task: ReflectionTask) => {
        const r = sequenceResultForTaskType(task.taskType);
        return r.ok
          ? { ok: true, taskType: task.taskType }
          : { ok: false, taskType: task.taskType, error: r.error ?? 'boom' };
      }),
    } as unknown as ReflectionRunner;
  }

  it('空队列 → 0/0/0/0', async () => {
    const memory = makeMemory();
    const scheduler = new ReflectionScheduler({
      memory,
      runner: makeRunnerMock(() => ({ ok: true })),
    });
    const r = await scheduler.runPending();
    expect(r).toEqual({ total: 0, succeeded: 0, failed: 0, skipped: 0 });
  });

  it('成功任务 → done + completedAt', async () => {
    const memory = makeMemory({
      tasks: [
        {
          id: 't1',
          visitId: 'v1',
          taskType: 'visit_summary',
          status: 'pending',
          attemptsCount: 0,
          createdAt: 1,
        },
      ],
    });
    const scheduler = new ReflectionScheduler({
      memory,
      runner: makeRunnerMock(() => ({ ok: true })),
      getNow: () => 999,
    });
    const r = await scheduler.runPending();
    expect(r.succeeded).toBe(1);
    expect(memory.state.tasks[0]!.status).toBe('done');
    expect(memory.state.tasks[0]!.completedAt).toBe(999);
  });

  it('失败 < maxAttempts → pending 并 attemptsCount++', async () => {
    const memory = makeMemory({
      tasks: [
        {
          id: 't1',
          visitId: 'v1',
          taskType: 'visit_summary',
          status: 'pending',
          attemptsCount: 0,
          createdAt: 1,
        },
      ],
    });
    const scheduler = new ReflectionScheduler({
      memory,
      runner: makeRunnerMock(() => ({ ok: false, error: 'x' })),
      maxAttempts: 3,
    });
    const r = await scheduler.runPending();
    expect(r.skipped).toBe(1);
    expect(memory.state.tasks[0]!.status).toBe('pending');
    expect(memory.state.tasks[0]!.attemptsCount).toBe(1);
    expect(memory.state.tasks[0]!.lastError).toBe('x');
  });

  it('失败达到 maxAttempts → failed', async () => {
    const memory = makeMemory({
      tasks: [
        {
          id: 't1',
          visitId: 'v1',
          taskType: 'visit_summary',
          status: 'pending',
          attemptsCount: 2, // 下次即达到 3
          createdAt: 1,
        },
      ],
    });
    const scheduler = new ReflectionScheduler({
      memory,
      runner: makeRunnerMock(() => ({ ok: false, error: 'x' })),
      maxAttempts: 3,
    });
    const r = await scheduler.runPending();
    expect(r.failed).toBe(1);
    expect(memory.state.tasks[0]!.status).toBe('failed');
  });

  it('attemptsCount >= maxAttempts 的 pending 不会被取出（由 listPendingReflections 过滤）', async () => {
    const memory = makeMemory({
      tasks: [
        {
          id: 't1',
          visitId: 'v1',
          taskType: 'visit_summary',
          status: 'pending',
          attemptsCount: 3,
          createdAt: 1,
        },
      ],
    });
    const scheduler = new ReflectionScheduler({
      memory,
      runner: makeRunnerMock(() => ({ ok: true })),
      maxAttempts: 3,
    });
    const r = await scheduler.runPending();
    expect(r.total).toBe(0);
  });

  it('maxTasksPerRun 限制批量', async () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      visitId: 'v1',
      taskType: 'visit_summary' as ReflectionTaskType,
      status: 'pending' as const,
      attemptsCount: 0,
      createdAt: 1,
    }));
    const memory = makeMemory({ tasks });
    const scheduler = new ReflectionScheduler({
      memory,
      runner: makeRunnerMock(() => ({ ok: true })),
      maxTasksPerRun: 3,
    });
    const r = await scheduler.runPending();
    expect(r.total).toBe(3);
    const done = memory.state.tasks.filter((t) => t.status === 'done').length;
    expect(done).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/* ReflectionScheduler · PageVisit 订阅                                */
/* ------------------------------------------------------------------ */

describe('ReflectionScheduler · registerOnPageVisitEnd', () => {
  it('visit 结束后登记 3 条任务', async () => {
    const memory = makeMemory();
    const runner = { run: vi.fn().mockResolvedValue({ ok: true, taskType: 'visit_summary' }) };
    const scheduler = new ReflectionScheduler({
      memory,
      runner: runner as unknown as ReflectionRunner,
    });
    const pvm = new PageVisitManager({ getNow: () => 1, genId: () => 'v1' });
    scheduler.registerOnPageVisitEnd(pvm);

    await pvm.startNewVisit({ url: 'https://x.com/a', canonicalUrl: 'https://x.com/a' });
    await pvm.endCurrent();
    // 让 microtask 跑完
    await new Promise((r) => setTimeout(r, 10));

    expect(memory.state.tasks.map((t) => t.taskType).sort()).toEqual([
      'persona_conflict_check',
      'persona_extraction',
      'visit_summary',
    ]);
  });
});
