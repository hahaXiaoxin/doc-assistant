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
import {
  NullMemoryStore,
  type MemoryStore,
  type MemoryRecord,
  type PageVisitRecord,
  type PersonaRecord,
  type RecallQuery,
  type ReflectionTask,
  type ReflectionTaskType,
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
  pageVisits: PageVisitRecord[];
}

function makeMemory(state: Partial<FakeMemoryState> = {}): MemoryStore & {
  state: FakeMemoryState;
} {
  const _state: FakeMemoryState = {
    episodes: state.episodes ?? [],
    visitSummaries: state.visitSummaries ?? [],
    personas: state.personas ?? [],
    tasks: state.tasks ?? [],
    pageVisits: state.pageVisits ?? [],
  };
  let idSeq = 0;
  const base = new NullMemoryStore();
  const store: MemoryStore & { state: FakeMemoryState } = Object.assign(base, {
    state: _state,
    async remember(record: MemoryRecord): Promise<void> {
      if (record.type === 'visit_summary') _state.visitSummaries.push(record);
      else _state.episodes.push(record);
    },
    async recall(query: RecallQuery): Promise<MemoryRecord[]> {
      const all =
        query.types?.includes('message') || !query.types
          ? _state.episodes
          : _state.visitSummaries;
      return all.slice(0, query.limit ?? 10);
    },
    async getPageVisit(visitId: string): Promise<PageVisitRecord | null> {
      return _state.pageVisits.find((v) => v.visitId === visitId) ?? null;
    },
    async listPersonas(
      { status }: { status?: PersonaRecord['status'] } = {},
    ): Promise<PersonaRecord[]> {
      return status ? _state.personas.filter((p) => p.status === status) : _state.personas;
    },
    async addPersonaCandidate(
      c: Omit<PersonaRecord, 'id' | 'createdAt' | 'updatedAt'>,
    ): Promise<PersonaRecord> {
      const rec: PersonaRecord = {
        id: `persona_${++idSeq}`,
        createdAt: 1,
        updatedAt: 1,
        ...c,
      };
      _state.personas.push(rec);
      return rec;
    },
    async updatePersona(id: string, patch: Partial<PersonaRecord>): Promise<void> {
      const i = _state.personas.findIndex((p) => p.id === id);
      if (i < 0) return;
      _state.personas[i] = { ..._state.personas[i]!, ...patch };
    },
    async enqueueReflection(
      task: Omit<ReflectionTask, 'id' | 'createdAt' | 'attemptsCount' | 'status'> & {
        id?: string;
        status?: ReflectionTask['status'];
      },
    ): Promise<ReflectionTask> {
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
    async listPendingReflections(maxAttempts = 3): Promise<ReflectionTask[]> {
      return _state.tasks.filter(
        (t) => t.status === 'pending' && t.attemptsCount < maxAttempts,
      );
    },
    async updateReflection(
      id: string,
      patch: Partial<ReflectionTask>,
    ): Promise<void> {
      const i = _state.tasks.findIndex((t) => t.id === id);
      if (i < 0) return;
      _state.tasks[i] = { ..._state.tasks[i]!, ...patch };
    },
  });
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
      '{"candidates":[{"subject":"agent","content":"默认使用 TypeScript 进行代码示例","confidence":0.9,"tags":["ts"]},{"subject":"agent","content":"回答时采用前端语境举例","confidence":1.5}]}',
    );
    expect(r).toHaveLength(2);
    expect(r[0]!.subject).toBe('agent');
    expect(r[0]!.tags).toEqual(['ts']);
    expect(r[1]!.confidence).toBe(1); // 归一化
  });
  it('同时含 agent / user 两类 candidate', () => {
    const r = parsePersonaOutput(
      '{"candidates":[{"subject":"user","content":"用户是前端工程师","confidence":0.9},{"subject":"agent","content":"回答时默认用前端语境","confidence":0.7}]}',
    );
    expect(r).toHaveLength(2);
    expect(r.map((c) => c.subject).sort()).toEqual(['agent', 'user']);
  });
  it('缺 subject 的 candidate 被过滤', () => {
    const r = parsePersonaOutput(
      '{"candidates":[{"content":"无 subject","confidence":0.9}]}',
    );
    expect(r).toEqual([]);
  });
  it('subject 非法值的 candidate 被过滤', () => {
    const r = parsePersonaOutput(
      '{"candidates":[{"subject":"other","content":"非法","confidence":0.9}]}',
    );
    expect(r).toEqual([]);
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

  it('page_visits 有 title → 写入 meta.title（供 list_recent_visits 清单显示）', async () => {
    const memory = makeMemory({
      episodes: [
        {
          id: 'm1',
          type: 'message',
          content: 'hi',
          timestamp: 1,
          visitId: 'v1',
          role: 'user',
          canonicalUrl: 'https://x/y',
          domain: 'x',
        },
      ],
      pageVisits: [
        {
          visitId: 'v1',
          startedAt: 1,
          url: 'https://x/y',
          canonicalUrl: 'https://x/y',
          domain: 'x',
          title: '某篇文章',
        },
      ],
    });
    const aux = fakeAux([
      { type: 'text-delta', delta: '{"summary":"摘要","tags":[]}' },
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
    expect(r.ok).toBe(true);
    expect(memory.state.visitSummaries).toHaveLength(1);
    const saved = memory.state.visitSummaries[0]!;
    expect(saved.meta).toBeDefined();
    expect((saved.meta as { title?: string }).title).toBe('某篇文章');
    expect((saved.meta as { source?: string }).source).toBe('reflection');
  });

  it('page_visits 无记录 → meta.title 不写入（消费方走 URL 兜底）', async () => {
    const memory = makeMemory({
      episodes: [
        {
          id: 'm1',
          type: 'message',
          content: 'hi',
          timestamp: 1,
          visitId: 'v1',
          role: 'user',
        },
      ],
      // pageVisits 为空
    });
    const aux = fakeAux([
      { type: 'text-delta', delta: '{"summary":"摘要"}' },
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
    expect(r.ok).toBe(true);
    const saved = memory.state.visitSummaries[0]!;
    expect((saved.meta as { title?: string }).title).toBeUndefined();
  });

  it('page_visits.title 为空串 → meta.title 不写入', async () => {
    const memory = makeMemory({
      episodes: [
        {
          id: 'm1',
          type: 'message',
          content: 'hi',
          timestamp: 1,
          visitId: 'v1',
          role: 'user',
        },
      ],
      pageVisits: [
        {
          visitId: 'v1',
          startedAt: 1,
          url: 'https://x/y',
          canonicalUrl: 'https://x/y',
          domain: 'x',
          title: '   ',
        },
      ],
    });
    const aux = fakeAux([
      { type: 'text-delta', delta: '{"summary":"摘要"}' },
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
    expect(r.ok).toBe(true);
    const saved = memory.state.visitSummaries[0]!;
    expect((saved.meta as { title?: string }).title).toBeUndefined();
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
        delta: '{"candidates":[{"subject":"agent","content":"默认使用 TypeScript 进行代码示例","confidence":0.9,"tags":["ts"]}]}',
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
    expect(memory.state.personas[0]!.subject).toBe('agent');
    expect(memory.state.personas[0]!.confidence).toBeCloseTo(0.9);
  });

  it('同一批对话能同时产出 agent + user 两类 candidate', async () => {
    const memory = makeMemory({
      episodes: [
        {
          id: 'm1',
          type: 'message',
          content: '我是前端工程师',
          timestamp: 1,
          visitId: 'v1',
          role: 'user',
        },
      ],
    });
    const aux = fakeAux([
      {
        type: 'text-delta',
        delta:
          '{"candidates":[' +
          '{"subject":"user","content":"用户是前端工程师","confidence":0.9},' +
          '{"subject":"agent","content":"回答时默认用前端语境举例","confidence":0.7}' +
          ']}',
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
    expect(memory.state.personas).toHaveLength(2);
    const subjects = memory.state.personas.map((p) => p.subject).sort();
    expect(subjects).toEqual(['agent', 'user']);
  });

  it('缺 subject 的候选被过滤掉(不落库)', async () => {
    const memory = makeMemory({
      episodes: [
        {
          id: 'm1',
          type: 'message',
          content: '任何',
          timestamp: 1,
          visitId: 'v1',
          role: 'user',
        },
      ],
    });
    const aux = fakeAux([
      {
        type: 'text-delta',
        delta:
          '{"candidates":[' +
          '{"content":"缺 subject 的条目","confidence":0.8},' +
          '{"subject":"user","content":"保留这条","confidence":0.8}' +
          ']}',
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
    expect(memory.state.personas[0]!.subject).toBe('user');
    expect(memory.state.personas[0]!.content).toBe('保留这条');
  });

  it('dedupe 按 (content, subject) 组合键: 同 content 不同 subject 不视为重复', async () => {
    const memory = makeMemory({
      personas: [
        {
          id: 'exist',
          subject: 'agent',
          content: '前端工程师',
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
          content: '任何',
          timestamp: 1,
          visitId: 'v1',
          role: 'user',
        },
      ],
    });
    const aux = fakeAux([
      {
        type: 'text-delta',
        delta:
          '{"candidates":[{"subject":"user","content":"前端工程师","confidence":0.9}]}',
      },
      { type: 'finish', finishReason: 'stop' },
    ]);
    const runner = new ReflectionRunner({ memory, aux });
    const r = await runner.run({
      id: 't2',
      visitId: 'v1',
      taskType: 'persona_extraction',
      status: 'pending',
      attemptsCount: 0,
      createdAt: 1,
    });
    expect(r.ok).toBe(true);
    // agent 侧老条目 + 新 user 侧条目,两条并存
    expect(memory.state.personas).toHaveLength(2);
    expect(memory.state.personas.find((p) => p.subject === 'agent')!.hitCount).toBe(
      1,
    );
    expect(memory.state.personas.find((p) => p.subject === 'user')!.content).toBe(
      '前端工程师',
    );
  });

  it('重复候选 → dedupe 并 hitCount++', async () => {
    const memory = makeMemory({
      personas: [
        {
          id: 'exist',
          subject: 'agent',
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
        delta: '{"candidates":[{"subject":"agent","content":"默认使用 TypeScript 进行代码示例","confidence":0.95}]}',
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
