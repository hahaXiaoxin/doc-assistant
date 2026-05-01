/**
 * 单测：recall_memory + list_recent_visits + remember_persona tool
 *
 * v0.4.0 · Chronological Index
 *   - recall_memory 取消 mode/time_query_unsupported 分支；扩参 timeRange/domain/articleId
 *   - 新增 list_recent_visits tool
 *   - detectTimeScopedMetaQuery 已上移至 agent 层（见 packages/agent/src/context/time-query.ts 单测）
 */
import { describe, it, expect, vi } from 'vitest';
import {
  NullMemoryStore,
  type MemoryStore,
  type PersonaRecord,
} from '@doc-assistant/memory';
import {
  createRecallMemoryTool,
  createListRecentVisitsTool,
  createRememberPersonaTool,
  buildPhase2Tools,
  type PageVisitLike,
  type Phase2ToolsDeps,
} from '../definitions';

import type { ToolDefinition } from '@doc-assistant/shared';

async function runTool<T>(
  tool: ToolDefinition,
  args: Record<string, unknown>,
): Promise<T> {
  return (await tool.execute(args, {})) as T;
}

/* ------------------------------------------------------------------ */
/* recall_memory                                                       */
/* ------------------------------------------------------------------ */

describe('recall_memory tool', () => {
  it('hit=false → 返回"未找到"', async () => {
    const tool = createRecallMemoryTool({
      recallSemantic: async () => ({ hit: false, text: '', count: 0 }),
    });
    const r = (await runTool(tool, { query: 'x' })) as {
      ok: boolean;
      hit?: boolean;
      message?: string;
    };
    expect(r.ok).toBe(true);
    expect(r.hit).toBe(false);
    expect(r.message).toContain('未在历史记忆');
  });

  it('hit=true → 透传 text + count', async () => {
    const tool = createRecallMemoryTool({
      recallSemantic: async () => ({ hit: true, text: '摘要 X', count: 2 }),
    });
    const r = (await runTool(tool, { query: 'x', limit: 5 })) as {
      ok: boolean;
      hit?: boolean;
      content?: string;
      count?: number;
    };
    expect(r.ok).toBe(true);
    expect(r.hit).toBe(true);
    expect(r.count).toBe(2);
    expect(r.content).toBe('摘要 X');
  });

  it('query 为空 → ok:false', async () => {
    const tool = createRecallMemoryTool({
      recallSemantic: async () => ({ hit: false, text: '', count: 0 }),
    });
    const r = (await runTool(tool, { query: '   ' })) as { ok: boolean };
    expect(r.ok).toBe(false);
  });

  it('正常语义 query 透传到 recallSemantic', async () => {
    const recallSemantic = vi
      .fn()
      .mockResolvedValue({ hit: false, text: '', count: 0 });
    const tool = createRecallMemoryTool({ recallSemantic });
    await runTool(tool, { query: '上次那个 agent loop 方案' });
    expect(recallSemantic).toHaveBeenCalledTimes(1);
    expect(recallSemantic).toHaveBeenCalledWith(
      expect.objectContaining({ query: '上次那个 agent loop 方案' }),
    );
  });

  it('时间维元查询不再被拦截（交由 list_recent_visits 负责）', async () => {
    const recallSemantic = vi
      .fn()
      .mockResolvedValue({ hit: false, text: '', count: 0 });
    const tool = createRecallMemoryTool({ recallSemantic });
    const r = (await runTool(tool, { query: '今天看了哪些文章' })) as {
      ok: boolean;
    };
    expect(r.ok).toBe(true);
    expect(recallSemantic).toHaveBeenCalledTimes(1);
  });

  it('扩参 timeRange/domain/articleId 透传', async () => {
    const recallSemantic = vi
      .fn()
      .mockResolvedValue({ hit: false, text: '', count: 0 });
    const tool = createRecallMemoryTool({ recallSemantic });
    await runTool(tool, {
      query: 'hooks',
      timeRange: 'this-week',
      domain: 'react.dev',
      articleId: 'a1',
      limit: 5,
    });
    expect(recallSemantic).toHaveBeenCalledWith({
      query: 'hooks',
      timeRange: 'this-week',
      domain: 'react.dev',
      articleId: 'a1',
      limit: 5,
    });
  });

  it('custom timeRange 必须带 startTs/endTs', async () => {
    const recallSemantic = vi.fn();
    const tool = createRecallMemoryTool({ recallSemantic });
    const r = (await runTool(tool, { query: 'x', timeRange: 'custom' })) as {
      ok: boolean;
      error?: string;
    };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/custom/);
    expect(recallSemantic).not.toHaveBeenCalled();
  });

  it('timeRange 非法值 → ok:false', async () => {
    const recallSemantic = vi.fn();
    const tool = createRecallMemoryTool({ recallSemantic });
    const r = (await runTool(tool, {
      query: 'x',
      timeRange: 'bogus',
    })) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timeRange/);
  });

  it('schema 只剩 query 必填；不存在 mode 字段', () => {
    const tool = createRecallMemoryTool({
      recallSemantic: async () => ({ hit: false, text: '', count: 0 }),
    });
    const schema = tool.parametersJsonSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required).toEqual(['query']);
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining([
        'query',
        'timeRange',
        'startTs',
        'endTs',
        'domain',
        'articleId',
        'limit',
      ]),
    );
    expect(schema.properties).not.toHaveProperty('mode');
  });

  it('recallSemantic 抛错 → ok:false', async () => {
    const tool = createRecallMemoryTool({
      recallSemantic: async () => {
        throw new Error('boom');
      },
    });
    const r = (await runTool(tool, { query: 'x' })) as {
      ok: boolean;
      error?: string;
    };
    expect(r.ok).toBe(false);
    expect(r.error).toContain('boom');
  });
});

/* ------------------------------------------------------------------ */
/* list_recent_visits                                                  */
/* ------------------------------------------------------------------ */

describe('list_recent_visits tool', () => {
  it('成功返回 visits 清单', async () => {
    const listRecentVisits = vi.fn().mockResolvedValue({
      count: 2,
      visits: [
        {
          visitId: 'v1',
          url: 'https://a.com/p',
          title: 'A',
          domain: 'a.com',
          summary: '这篇文章讲了 X',
          tags: ['x'],
          timestamp: 1000,
        },
        {
          visitId: 'v2',
          url: 'https://b.com/p',
          domain: 'b.com',
          summary: '这篇讲 Y',
          tags: [],
          timestamp: 900,
        },
      ],
    });
    const tool = createListRecentVisitsTool({ listRecentVisits });
    const r = (await runTool(tool, { timeRange: 'today' })) as {
      ok: boolean;
      count?: number;
      visits?: unknown[];
    };
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
    expect(r.visits).toHaveLength(2);
    expect(listRecentVisits).toHaveBeenCalledWith(
      expect.objectContaining({ timeRange: 'today', limit: 20 }),
    );
  });

  it.each([
    ['today'],
    ['yesterday'],
    ['this-week'],
    ['last-week'],
    ['last-7-days'],
  ] as const)('预设 timeRange=%s 能透传并返回', async (tr) => {
    const listRecentVisits = vi
      .fn()
      .mockResolvedValue({ count: 0, visits: [] });
    const tool = createListRecentVisitsTool({ listRecentVisits });
    const r = (await runTool(tool, { timeRange: tr })) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(listRecentVisits).toHaveBeenCalledWith(
      expect.objectContaining({ timeRange: tr }),
    );
  });

  it('custom timeRange 必须 startTs + endTs', async () => {
    const listRecentVisits = vi
      .fn()
      .mockResolvedValue({ count: 0, visits: [] });
    const tool = createListRecentVisitsTool({ listRecentVisits });
    const r1 = (await runTool(tool, { timeRange: 'custom' })) as {
      ok: boolean;
      error?: string;
    };
    expect(r1.ok).toBe(false);
    expect(r1.error).toMatch(/custom/);

    const r2 = (await runTool(tool, {
      timeRange: 'custom',
      startTs: 100,
      endTs: 200,
    })) as { ok: boolean };
    expect(r2.ok).toBe(true);
    expect(listRecentVisits).toHaveBeenCalledTimes(1);
  });

  it('custom endTs < startTs → ok:false', async () => {
    const listRecentVisits = vi.fn();
    const tool = createListRecentVisitsTool({ listRecentVisits });
    const r = (await runTool(tool, {
      timeRange: 'custom',
      startTs: 200,
      endTs: 100,
    })) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(listRecentVisits).not.toHaveBeenCalled();
  });

  it('domain 过滤透传', async () => {
    const listRecentVisits = vi
      .fn()
      .mockResolvedValue({ count: 0, visits: [] });
    const tool = createListRecentVisitsTool({ listRecentVisits });
    await runTool(tool, { timeRange: 'today', domain: 'github.com' });
    expect(listRecentVisits).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'github.com' }),
    );
  });

  it('limit 上限 50（超过被 clamp）', async () => {
    const listRecentVisits = vi
      .fn()
      .mockResolvedValue({ count: 0, visits: [] });
    const tool = createListRecentVisitsTool({ listRecentVisits });
    await runTool(tool, { timeRange: 'today', limit: 999 });
    expect(listRecentVisits).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
  });

  it('缺 timeRange 必填 → ok:false', async () => {
    const listRecentVisits = vi.fn();
    const tool = createListRecentVisitsTool({ listRecentVisits });
    const r = (await runTool(tool, {})) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(listRecentVisits).not.toHaveBeenCalled();
  });

  it('schema：timeRange 必填，startTs/endTs/domain/limit 可选', () => {
    const tool = createListRecentVisitsTool({
      listRecentVisits: async () => ({ count: 0, visits: [] }),
    });
    const schema = tool.parametersJsonSchema as {
      required?: string[];
      properties?: Record<string, { maximum?: number }>;
    };
    expect(schema.required).toEqual(['timeRange']);
    expect(schema.properties?.limit?.maximum).toBe(50);
  });

  it('title 缺失 → 走 URL hostname+path 兜底（保证清单可读）', async () => {
    const listRecentVisits = vi.fn().mockResolvedValue({
      count: 3,
      visits: [
        // 无 title
        {
          visitId: 'v1',
          url: 'https://github.com/foo/bar?x=1',
          summary: 's1',
          tags: [],
          timestamp: 1,
        },
        // title 空串
        {
          visitId: 'v2',
          url: 'https://example.com/',
          title: '',
          summary: 's2',
          tags: [],
          timestamp: 2,
        },
        // title 全是空格
        {
          visitId: 'v3',
          url: 'https://docs.rs/serde/latest/serde/',
          title: '   ',
          summary: 's3',
          tags: [],
          timestamp: 3,
        },
      ],
    });
    const tool = createListRecentVisitsTool({ listRecentVisits });
    const r = (await runTool(tool, { timeRange: 'today' })) as {
      ok: boolean;
      visits?: Array<{ visitId: string; title?: string }>;
    };
    expect(r.ok).toBe(true);
    expect(r.visits?.[0]?.title).toBe('github.com/foo/bar');
    expect(r.visits?.[1]?.title).toBe('example.com');
    expect(r.visits?.[2]?.title).toBe('docs.rs/serde/latest/serde');
  });

  it('title 非空 → 不做覆盖（尊重原值）', async () => {
    const listRecentVisits = vi.fn().mockResolvedValue({
      count: 1,
      visits: [
        {
          visitId: 'v1',
          url: 'https://github.com/foo/bar',
          title: '真实标题',
          summary: 's',
          tags: [],
          timestamp: 1,
        },
      ],
    });
    const tool = createListRecentVisitsTool({ listRecentVisits });
    const r = (await runTool(tool, { timeRange: 'today' })) as {
      ok: boolean;
      visits?: Array<{ title?: string }>;
    };
    expect(r.visits?.[0]?.title).toBe('真实标题');
  });

  it('title 缺失且 URL 非法 → title 字段不出现（调用方自己决定如何展示）', async () => {
    const listRecentVisits = vi.fn().mockResolvedValue({
      count: 1,
      visits: [
        {
          visitId: 'v1',
          url: '',
          summary: 's',
          tags: [],
          timestamp: 1,
        },
      ],
    });
    const tool = createListRecentVisitsTool({ listRecentVisits });
    const r = (await runTool(tool, { timeRange: 'today' })) as {
      ok: boolean;
      visits?: Array<{ title?: string }>;
    };
    expect(r.visits?.[0]?.title).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* remember_persona                                                    */
/* ------------------------------------------------------------------ */

describe('remember_persona tool', () => {
  function makeMemory(): MemoryStore & { added: PersonaRecord[] } {
    const added: PersonaRecord[] = [];
    let idSeq = 0;
    const base = new NullMemoryStore();
    return Object.assign(base, {
      added,
      async addPersonaCandidate(
        c: Omit<PersonaRecord, 'id' | 'createdAt' | 'updatedAt'>,
      ): Promise<PersonaRecord> {
        const rec: PersonaRecord = {
          id: `p_${++idSeq}`,
          createdAt: 1,
          updatedAt: 1,
          ...c,
        };
        added.push(rec);
        return rec;
      },
    });
  }

  it('成功写入 confirmed Persona（subject=user）', async () => {
    const memory = makeMemory();
    const tool = createRememberPersonaTool({
      memory,
      getCurrentVisitId: () => 'v42',
    });
    const r = (await runTool(tool, {
      content: '用户偏好 TypeScript',
      subject: 'user',
      confidence: 0.85,
      tags: ['ts'],
    })) as { ok: boolean; persona?: PersonaRecord };
    expect(r.ok).toBe(true);
    expect(r.persona?.subject).toBe('user');
    expect(r.persona?.status).toBe('confirmed');
    expect(r.persona?.reviewedByUser).toBe(true);
    expect(r.persona?.source.extractedBy).toBe('user_explicit');
    expect(r.persona?.source.visitId).toBe('v42');
    expect(r.persona?.tags).toEqual(['ts']);
    expect(memory.added).toHaveLength(1);
  });

  it('成功写入 confirmed Persona（subject=agent）', async () => {
    const memory = makeMemory();
    const tool = createRememberPersonaTool({ memory });
    const r = (await runTool(tool, {
      content: '你叫小瑾',
      subject: 'agent',
    })) as { ok: boolean; persona?: PersonaRecord };
    expect(r.ok).toBe(true);
    expect(r.persona?.subject).toBe('agent');
  });

  it('confidence 超界 → 归一化', async () => {
    const memory = makeMemory();
    const tool = createRememberPersonaTool({ memory });
    const r = (await runTool(tool, {
      content: '用户是前端开发者',
      subject: 'user',
      confidence: 1.5,
    })) as { ok: boolean; persona?: PersonaRecord };
    expect(r.persona?.confidence).toBe(1);
  });

  it('content 为空 → ok:false', async () => {
    const memory = makeMemory();
    const tool = createRememberPersonaTool({ memory });
    const r = (await runTool(tool, { content: '  ', subject: 'user' })) as {
      ok: boolean;
    };
    expect(r.ok).toBe(false);
  });

  it('subject 非法值 → ok:false', async () => {
    const memory = makeMemory();
    const tool = createRememberPersonaTool({ memory });
    const r = (await runTool(tool, {
      content: '任意内容',
      subject: 'bogus' as unknown as 'agent',
    })) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/subject/);
  });

  it('schema 必填 content + subject', () => {
    const memory = makeMemory();
    const tool = createRememberPersonaTool({ memory });
    const schema = tool.parametersJsonSchema as {
      required?: string[];
      properties?: Record<string, { enum?: string[] }>;
    };
    expect(schema.required).toContain('content');
    expect(schema.required).toContain('subject');
    expect(schema.properties?.subject?.enum).toEqual(['agent', 'user']);
  });
});

/* ------------------------------------------------------------------ */
/* buildPhase2Tools 集成                                                */
/* ------------------------------------------------------------------ */

describe('buildPhase2Tools · 按 deps 动态注册', () => {
  function makeDeps(overrides: Partial<Phase2ToolsDeps> = {}): Phase2ToolsDeps {
    const base = new NullMemoryStore();
    const memory: MemoryStore = Object.assign(base, {
      async addPersonaCandidate(
        c: Omit<PersonaRecord, 'id' | 'createdAt' | 'updatedAt'>,
      ): Promise<PersonaRecord> {
        return { id: 'p1', createdAt: 1, updatedAt: 1, ...c } as PersonaRecord;
      },
    });
    return {
      memory,
      getCurrentVisit: (): PageVisitLike => ({
        visitId: 'v1',
        canonicalUrl: 'https://x',
        domain: 'x',
      }),
      ...overrides,
    };
  }

  it('recallSemantic + listRecentVisits 都注入 → 13 个 tool', () => {
    const tools = buildPhase2Tools({
      ...makeDeps(),
      recallSemantic: async () => ({ hit: false, text: '', count: 0 }),
      listRecentVisits: async () => ({ count: 0, visits: [] }),
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain('recall_memory');
    expect(names).toContain('list_recent_visits');
    expect(names).toContain('remember_persona');
    // MVP 3 + WM 7 + persona + recall + list_recent_visits = 13
    expect(tools.length).toBe(13);
  });

  it('只注入 recallSemantic → 12 个，不含 list_recent_visits', () => {
    const tools = buildPhase2Tools({
      ...makeDeps(),
      recallSemantic: async () => ({ hit: false, text: '', count: 0 }),
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain('recall_memory');
    expect(names).not.toContain('list_recent_visits');
    expect(tools.length).toBe(12);
  });

  it('两个都不注入 → 11 个', () => {
    const tools = buildPhase2Tools(makeDeps());
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('recall_memory');
    expect(names).not.toContain('list_recent_visits');
    expect(names).toContain('remember_persona');
    expect(tools.length).toBe(11);
  });
});
