/**
 * 单测：DexieMemoryStore
 * ---------------------------------------------
 * 使用 fake-indexeddb 跑 Dexie。每个用例用独立 dbName 实现隔离。
 */
import './setup-idb';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DexieMemoryStore } from '../db/dexie-store';
import type {
  MemoryRecord,
  WorkingMemoryRecord,
  SessionTopicRecord,
} from '../interface';

function makeStore(opts: ConstructorParameters<typeof DexieMemoryStore>[0] = {}) {
  return new DexieMemoryStore({
    dbName: `test-db-${Math.random().toString(36).slice(2)}`,
    sensitiveFilterEnabled: false,
    ...opts,
  });
}

describe('DexieMemoryStore · remember + recall 基础', () => {
  let store: DexieMemoryStore;
  beforeEach(() => {
    store = makeStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it('visit_summary 写入后能召回', async () => {
    const rec: MemoryRecord = {
      id: 'v1',
      type: 'visit_summary',
      content: '聊了 React Hooks',
      timestamp: 1000,
      canonicalUrl: 'https://react.dev/learn',
      domain: 'react.dev',
    };
    await store.remember(rec);
    const out = await store.recall({ canonicalUrl: 'https://react.dev/learn' });
    expect(out.length).toBe(1);
    expect(out[0]?.content).toContain('Hooks');
  });

  it('message 写入 episodes_msg 表，不出现在默认 recall（默认召回 visit_summary）', async () => {
    await store.remember({
      id: 'm1',
      type: 'message',
      content: 'hello',
      timestamp: 1000,
    });
    const out = await store.recall({}); // 默认 types=['visit_summary']
    expect(out.length).toBe(0);

    const out2 = await store.recall({ types: ['message'] });
    expect(out2.length).toBe(1);
    expect(out2[0]?.content).toBe('hello');
  });

  // v0.2.3 · rehydrate 核心链路：跨 visit 按 canonicalUrl 召回消息
  it('message 跨 visit 按 canonicalUrl 召回（rehydrate 的底层能力）', async () => {
    const url = 'https://example.com/article';
    // visit A 的消息
    await store.remember({
      id: 'a1',
      type: 'message',
      content: '我们聊 agent loop',
      role: 'user',
      timestamp: 100,
      visitId: 'visit-a',
      canonicalUrl: url,
      orderInVisit: 0,
    });
    await store.remember({
      id: 'a2',
      type: 'message',
      content: '好的，loop 是怎么设计的...',
      role: 'assistant',
      timestamp: 110,
      visitId: 'visit-a',
      canonicalUrl: url,
      orderInVisit: 1,
    });
    // visit B 的消息（同一 canonicalUrl，不同 visitId——模拟用户刷新页面）
    await store.remember({
      id: 'b1',
      type: 'message',
      content: '上次我们聊到哪了',
      role: 'user',
      timestamp: 200,
      visitId: 'visit-b',
      canonicalUrl: url,
      orderInVisit: 0,
    });
    // 无关 URL 的消息（不该被召回）
    await store.remember({
      id: 'c1',
      type: 'message',
      content: '其他页面的对话',
      role: 'user',
      timestamp: 150,
      visitId: 'visit-c',
      canonicalUrl: 'https://other.com/x',
      orderInVisit: 0,
    });

    const out = await store.recall({
      types: ['message'],
      canonicalUrl: url,
      limit: 50,
    });
    // 只应拿到 a1/a2/b1 三条，按 timestamp 降序（dexie 默认），不含 c1
    expect(out.map((r) => r.id).sort()).toEqual(['a1', 'a2', 'b1']);
    // 验证关键元数据都保留：role / visitId / orderInVisit 在 rehydrate 时要用
    const a1 = out.find((r) => r.id === 'a1');
    expect(a1?.role).toBe('user');
    expect(a1?.visitId).toBe('visit-a');
    expect(a1?.orderInVisit).toBe(0);
  });

  it('多条按 timestamp 倒序返回', async () => {
    await store.remember({ id: 'a', type: 'visit_summary', content: 'a', timestamp: 100 });
    await store.remember({ id: 'b', type: 'visit_summary', content: 'b', timestamp: 300 });
    await store.remember({ id: 'c', type: 'visit_summary', content: 'c', timestamp: 200 });
    const out = await store.recall({});
    expect(out.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('limit 生效', async () => {
    for (let i = 0; i < 5; i++) {
      await store.remember({ id: `v${i}`, type: 'visit_summary', content: `c${i}`, timestamp: i * 100 });
    }
    const out = await store.recall({ limit: 2 });
    expect(out.length).toBe(2);
  });

  it('timeRange 过滤', async () => {
    await store.remember({ id: 'a', type: 'visit_summary', content: 'a', timestamp: 100 });
    await store.remember({ id: 'b', type: 'visit_summary', content: 'b', timestamp: 500 });
    await store.remember({ id: 'c', type: 'visit_summary', content: 'c', timestamp: 1000 });
    const out = await store.recall({ timeRange: [200, 800] });
    expect(out.map((r) => r.id)).toEqual(['b']);
  });

  it('domain 过滤', async () => {
    await store.remember({
      id: 'a',
      type: 'visit_summary',
      content: 'react',
      timestamp: 100,
      domain: 'react.dev',
    });
    await store.remember({
      id: 'b',
      type: 'visit_summary',
      content: 'mdn',
      timestamp: 200,
      domain: 'mdn.dev',
    });
    const out = await store.recall({ domain: 'react.dev' });
    expect(out.map((r) => r.id)).toEqual(['a']);
  });
});

describe('DexieMemoryStore · 敏感信息过滤', () => {
  it('默认开启：写入时 content 被 redact', async () => {
    const store = new DexieMemoryStore({
      dbName: `test-filter-${Math.random().toString(36).slice(2)}`,
      sensitiveFilterEnabled: true,
    });
    await store.remember({
      id: 'x',
      type: 'visit_summary',
      content: '联系 alice@example.com 手机 13912345678',
      timestamp: 1,
      canonicalUrl: 'https://a.com/x',
    });
    const out = await store.recall({ canonicalUrl: 'https://a.com/x' });
    expect(out[0]?.content).not.toContain('alice@example.com');
    expect(out[0]?.content).not.toContain('13912345678');
    expect(out[0]?.content).toContain('[REDACTED:email]');
    expect(out[0]?.content).toContain('[REDACTED:phone]');
    await store.close();
  });

  it('关闭后原文保留', async () => {
    const store = new DexieMemoryStore({
      dbName: `test-filter-off-${Math.random().toString(36).slice(2)}`,
      sensitiveFilterEnabled: false,
    });
    await store.remember({
      id: 'x',
      type: 'visit_summary',
      content: 'alice@example.com',
      timestamp: 1,
      canonicalUrl: 'https://a.com/x',
    });
    const out = await store.recall({ canonicalUrl: 'https://a.com/x' });
    expect(out[0]?.content).toBe('alice@example.com');
    await store.close();
  });
});

describe('DexieMemoryStore · 语义召回（向量）', () => {
  it('注入 embedQuery 时按余弦排序', async () => {
    const store = new DexieMemoryStore({
      dbName: `test-embed-${Math.random().toString(36).slice(2)}`,
      sensitiveFilterEnabled: false,
      embedQuery: async (text) => {
        // 简化：query = "react" 返回 [1,0,0]；其它返回 [0,1,0]
        if (text.includes('react')) return new Float32Array([1, 0, 0]);
        return new Float32Array([0, 1, 0]);
      },
    });
    await store.remember({
      id: 'a',
      type: 'visit_summary',
      content: 'react hooks',
      timestamp: 1,
      embedding: new Float32Array([0.9, 0.1, 0]),
    });
    await store.remember({
      id: 'b',
      type: 'visit_summary',
      content: 'vue composition',
      timestamp: 2,
      embedding: new Float32Array([0.1, 0.9, 0]),
    });
    const out = await store.recall({ semantic: 'react' });
    expect(out[0]?.id).toBe('a'); // react 向量更相似
    expect(out[1]?.id).toBe('b');
    await store.close();
  });

  it('embedQuery 失败时降级到关键词 LIKE', async () => {
    const store = new DexieMemoryStore({
      dbName: `test-embed-fallback-${Math.random().toString(36).slice(2)}`,
      sensitiveFilterEnabled: false,
      embedQuery: async () => {
        throw new Error('embed fail');
      },
    });
    await store.remember({ id: 'a', type: 'visit_summary', content: 'react hooks', timestamp: 1 });
    await store.remember({ id: 'b', type: 'visit_summary', content: 'vue composition', timestamp: 2 });
    const out = await store.recall({ semantic: 'react' });
    expect(out.length).toBe(1);
    expect(out[0]?.id).toBe('a');
    await store.close();
  });

  it('无 embedQuery 时直接走关键词 LIKE', async () => {
    const store = new DexieMemoryStore({
      dbName: `test-kw-only-${Math.random().toString(36).slice(2)}`,
      sensitiveFilterEnabled: false,
    });
    await store.remember({ id: 'a', type: 'visit_summary', content: 'react hooks', timestamp: 1 });
    await store.remember({ id: 'b', type: 'visit_summary', content: 'vue composition', timestamp: 2 });
    const out = await store.recall({ semantic: 'vue' });
    expect(out.length).toBe(1);
    expect(out[0]?.id).toBe('b');
    await store.close();
  });
});

describe('DexieMemoryStore · WorkingMemory', () => {
  let store: DexieMemoryStore;
  beforeEach(() => {
    store = makeStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it('set / get 基础往返', async () => {
    const wm: WorkingMemoryRecord = {
      canonicalUrl: 'https://react.dev/useEffect',
      visitId: 'v1',
      todos: [
        {
          id: 't1',
          content: '搞清楚 useEffect 的 cleanup 时机',
          status: 'pending',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1,
    };
    await store.setWorkingMemory(wm);
    const got = await store.getWorkingMemory('https://react.dev/useEffect');
    expect(got).not.toBeNull();
    expect(got?.todos.length).toBe(1);
    expect(got?.todos[0]?.content).toContain('cleanup');
  });

  it('touch 刷新 lastAccessedAt', async () => {
    let now = 1000;
    const s = new DexieMemoryStore({
      dbName: `test-touch-${Math.random().toString(36).slice(2)}`,
      sensitiveFilterEnabled: false,
      getNow: () => now,
    });
    await s.setWorkingMemory({
      canonicalUrl: 'u',
      todos: [],
      createdAt: 1000,
      updatedAt: 1000,
      lastAccessedAt: 1000,
    });
    now = 5000;
    await s.touchWorkingMemory('u');
    const got = await s.getWorkingMemory('u');
    expect(got?.lastAccessedAt).toBe(5000);
    await s.close();
  });

  it('archiveStaleWorkingMemories 归档超期条目并写 episodes_visit_summary', async () => {
    const now = 10_000;
    const s = new DexieMemoryStore({
      dbName: `test-archive-${Math.random().toString(36).slice(2)}`,
      sensitiveFilterEnabled: false,
      getNow: () => now,
    });
    // 两条：一条未过期、一条过期且有未完成 todo
    await s.setWorkingMemory({
      canonicalUrl: 'fresh',
      todos: [{ id: 't1', content: '做 X', status: 'pending', createdAt: 1, updatedAt: 1 }],
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 9_000,
    });
    await s.setWorkingMemory({
      canonicalUrl: 'stale',
      todos: [{ id: 't2', content: '做 Y', status: 'pending', createdAt: 1, updatedAt: 1 }],
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1_000,
    });
    // ttl=5000，当前 now=10000 → 阈值 5000；stale 的 lastAccessedAt=1000 过期
    const archived = await s.archiveStaleWorkingMemories(5_000);
    expect(archived).toBe(1);

    // 检查 stale 被标 archivedAt
    const stale = await s.getWorkingMemory('stale');
    expect(stale?.archivedAt).toBe(10_000);
    const fresh = await s.getWorkingMemory('fresh');
    expect(fresh?.archivedAt).toBeUndefined();

    // 检查 episodes_visit_summary 中有归档副本
    const summaries = await s.recall({ canonicalUrl: 'stale' });
    expect(summaries.length).toBe(1);
    expect(summaries[0]?.content).toContain('做 Y');
    await s.close();
  });

  it('archive 不对已归档条目重复处理', async () => {
    const now = 10_000;
    const s = new DexieMemoryStore({
      dbName: `test-archive-dedup-${Math.random().toString(36).slice(2)}`,
      sensitiveFilterEnabled: false,
      getNow: () => now,
    });
    await s.setWorkingMemory({
      canonicalUrl: 'u',
      todos: [{ id: 't', content: 'x', status: 'pending', createdAt: 1, updatedAt: 1 }],
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1_000,
      archivedAt: 5_000,
    });
    const archived = await s.archiveStaleWorkingMemories(5_000);
    expect(archived).toBe(0);
    await s.close();
  });
});

describe('DexieMemoryStore · Persona', () => {
  let store: DexieMemoryStore;
  beforeEach(() => {
    store = makeStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it('addPersonaCandidate + listPersonas', async () => {
    const p = await store.addPersonaCandidate({
      content: '用户偏好 TypeScript',
      status: 'pending',
      confidence: 0.8,
      hitCount: 1,
      reviewedByUser: false,
      source: { extractedBy: 'reflection' },
    });
    expect(p.id).toBeTruthy();
    const pending = await store.listPersonas({ status: 'pending' });
    expect(pending.length).toBe(1);
    expect(pending[0]?.content).toContain('TypeScript');
  });

  it('updatePersona 记录 history', async () => {
    const p = await store.addPersonaCandidate({
      content: '初始内容',
      status: 'pending',
      confidence: 0.5,
      hitCount: 1,
      reviewedByUser: false,
      source: { extractedBy: 'reflection' },
    });
    await store.updatePersona(p.id, { content: '编辑后' }, 'user_edit');
    const confirmed = await store.listPersonas();
    const updated = confirmed.find((x) => x.id === p.id);
    expect(updated?.content).toBe('编辑后');
    expect(updated?.history?.length).toBe(1);
    expect(updated?.history?.[0]?.reason).toBe('user_edit');
  });

  it('按 status 过滤', async () => {
    await store.addPersonaCandidate({
      content: 'a',
      status: 'pending',
      confidence: 0.5,
      hitCount: 1,
      reviewedByUser: false,
      source: { extractedBy: 'reflection' },
    });
    await store.addPersonaCandidate({
      content: 'b',
      status: 'confirmed',
      confidence: 1,
      hitCount: 3,
      reviewedByUser: true,
      source: { extractedBy: 'user_explicit' },
    });
    const pending = await store.listPersonas({ status: 'pending' });
    const confirmed = await store.listPersonas({ status: 'confirmed' });
    expect(pending.length).toBe(1);
    expect(confirmed.length).toBe(1);
  });

  it('remember(type=persona) 写入为 confirmed Persona', async () => {
    await store.remember({
      id: 'p1',
      type: 'persona',
      content: '用户喜欢函数式编程',
      timestamp: 1000,
      meta: { confidence: 0.9, tags: ['programming-style'] },
    });
    const all = await store.listPersonas();
    expect(all.length).toBe(1);
    expect(all[0]?.status).toBe('confirmed');
    expect(all[0]?.reviewedByUser).toBe(true);
    expect(all[0]?.tags).toEqual(['programming-style']);
  });
});

describe('DexieMemoryStore · SessionTopic', () => {
  let store: DexieMemoryStore;
  beforeEach(() => {
    store = makeStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it('set / get 往返', async () => {
    const topic: SessionTopicRecord = {
      visitId: 'v1',
      canonicalUrl: 'https://a.com/x',
      currentTopic: 'React 并发模式',
      tags: ['react', 'concurrent'],
      updatedAt: 1,
      history: [{ at: 1, topic: 'React 并发模式', triggeredBy: 'auto' }],
    };
    await store.setSessionTopic(topic);
    const got = await store.getSessionTopic('v1');
    expect(got?.currentTopic).toContain('并发');
    expect(got?.tags.length).toBe(2);
  });

  it('getSessionTopic 不存在返回 null', async () => {
    const got = await store.getSessionTopic('no-such-visit');
    expect(got).toBeNull();
  });
});

describe('DexieMemoryStore · ReflectionTask', () => {
  let store: DexieMemoryStore;
  beforeEach(() => {
    store = makeStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it('enqueueReflection + listPendingReflections', async () => {
    const t = await store.enqueueReflection({
      visitId: 'v1',
      taskType: 'visit_summary',
    });
    expect(t.id).toBeTruthy();
    expect(t.status).toBe('pending');
    expect(t.attemptsCount).toBe(0);
    const pending = await store.listPendingReflections();
    expect(pending.length).toBe(1);
  });

  it('updateReflection 推进状态', async () => {
    const t = await store.enqueueReflection({
      visitId: 'v1',
      taskType: 'visit_summary',
    });
    await store.updateReflection(t.id, { status: 'running', attemptsCount: 1 });
    const pending = await store.listPendingReflections();
    expect(pending.length).toBe(0); // running 不在 pending 列表
    await store.updateReflection(t.id, {
      status: 'done',
      completedAt: 999,
    });
  });

  it('attemptsCount >= maxAttempts 不再列为 pending', async () => {
    const t = await store.enqueueReflection({
      visitId: 'v1',
      taskType: 'visit_summary',
    });
    await store.updateReflection(t.id, { attemptsCount: 3 });
    const pending = await store.listPendingReflections(3);
    expect(pending.length).toBe(0);
  });
});

describe('DexieMemoryStore · PageVisit', () => {
  it('recordPageVisit 可重复写（upsert）', async () => {
    const s = makeStore();
    await s.recordPageVisit({
      visitId: 'v1',
      startedAt: 1000,
      url: 'https://a.com',
      canonicalUrl: 'https://a.com',
      domain: 'a.com',
    });
    await s.recordPageVisit({
      visitId: 'v1',
      startedAt: 1000,
      endedAt: 2000,
      url: 'https://a.com',
      canonicalUrl: 'https://a.com',
      domain: 'a.com',
    });
    // 再次能查到带 endedAt 的版本
    const db = s._unsafeGetDb();
    const row = await db.page_visits.get('v1');
    expect(row?.endedAt).toBe(2000);
    await s.close();
  });
});

describe('DexieMemoryStore · 读路径 schema 防腐', () => {
  it('recall 跳过非法 type（例如遗留的 fact）并 warn', async () => {
    const s = makeStore();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const db = s._unsafeGetDb();
    // 直接往底层表塞脏数据（模拟遗留 v0.1 记录）
    await db.episodes_msg.put({
      id: 'dirty',
      // @ts-expect-error - 故意塞入已被收窄移除的 type
      type: 'fact',
      content: '旧版本数据',
      timestamp: 1,
    });
    await db.episodes_msg.put({
      id: 'clean',
      type: 'message',
      content: '新版本数据',
      timestamp: 2,
    });

    const out = await s.recall({ types: ['message'] });
    expect(out.map((r) => r.id)).toEqual(['clean']);
    // warn 至少被调用了一次（我们使用的 logger 底层走 console）
    const warnCalls = warnSpy.mock.calls.concat(errorSpy.mock.calls);
    const matched = warnCalls.some((call) =>
      call.some(
        (a) =>
          typeof a === 'string' && /脏记录|schema 防腐|非法 type|1 条/.test(a),
      ),
    );
    expect(matched).toBe(true);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
    await s.close();
  });
});
