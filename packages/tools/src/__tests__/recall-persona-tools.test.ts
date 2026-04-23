/**
 * 单测：recall_memory + remember_persona tool
 */
import { describe, it, expect, vi } from 'vitest';
import type { MemoryStore, PersonaRecord } from '@doc-assistant/memory';
import {
  createRecallMemoryTool,
  createRememberPersonaTool,
  buildPhase2Tools,
  type PageVisitLike,
  type Phase2ToolsDeps,
} from '../definitions';

async function runTool<T>(
  tool: ReturnType<typeof createRecallMemoryTool>,
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
      recall: async () => ({ hit: false, text: '', count: 0 }),
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
      recall: async () => ({ hit: true, text: '摘要 X', count: 2 }),
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
      recall: async () => ({ hit: false, text: '', count: 0 }),
    });
    const r = (await runTool(tool, { query: '   ' })) as { ok: boolean };
    expect(r.ok).toBe(false);
  });

  it('默认 mode=explicit', async () => {
    const recall = vi.fn().mockResolvedValue({ hit: false, text: '', count: 0 });
    const tool = createRecallMemoryTool({ recall });
    await runTool(tool, { query: 'x' });
    expect(recall).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'explicit' }),
    );
  });

  it('recall 抛错 → ok:false', async () => {
    const tool = createRecallMemoryTool({
      recall: async () => {
        throw new Error('boom');
      },
    });
    const r = (await runTool(tool, { query: 'x' })) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toContain('boom');
  });
});

/* ------------------------------------------------------------------ */
/* remember_persona                                                    */
/* ------------------------------------------------------------------ */

describe('remember_persona tool', () => {
  function makeMemory(): MemoryStore & { added: PersonaRecord[] } {
    const added: PersonaRecord[] = [];
    let idSeq = 0;
    return {
      added,
      async remember() {},
      async recall() {
        return [];
      },
      async addPersonaCandidate(c) {
        const rec: PersonaRecord = {
          id: `p_${++idSeq}`,
          createdAt: 1,
          updatedAt: 1,
          ...c,
        };
        added.push(rec);
        return rec;
      },
    };
  }

  it('成功写入 confirmed Persona', async () => {
    const memory = makeMemory();
    const tool = createRememberPersonaTool({
      memory,
      getCurrentVisitId: () => 'v42',
    });
    const r = (await runTool(tool, {
      content: '偏好 TypeScript',
      confidence: 0.85,
      tags: ['ts'],
    })) as { ok: boolean; persona?: PersonaRecord };
    expect(r.ok).toBe(true);
    expect(r.persona?.status).toBe('confirmed');
    expect(r.persona?.reviewedByUser).toBe(true);
    expect(r.persona?.source.extractedBy).toBe('user_explicit');
    expect(r.persona?.source.visitId).toBe('v42');
    expect(r.persona?.tags).toEqual(['ts']);
    expect(memory.added).toHaveLength(1);
  });

  it('confidence 超界 → 归一化', async () => {
    const memory = makeMemory();
    const tool = createRememberPersonaTool({ memory });
    const r = (await runTool(tool, {
      content: '前端开发者',
      confidence: 1.5,
    })) as { ok: boolean; persona?: PersonaRecord };
    expect(r.persona?.confidence).toBe(1);
  });

  it('content 为空 → ok:false', async () => {
    const memory = makeMemory();
    const tool = createRememberPersonaTool({ memory });
    const r = (await runTool(tool, { content: '  ' })) as { ok: boolean };
    expect(r.ok).toBe(false);
  });

  it('memory 不支持 addPersonaCandidate → ok:false', async () => {
    const memory: MemoryStore = {
      async remember() {},
      async recall() {
        return [];
      },
    };
    const tool = createRememberPersonaTool({ memory });
    const r = (await runTool(tool, { content: 'x' })) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Persona/);
  });
});

/* ------------------------------------------------------------------ */
/* buildPhase2Tools 集成                                                */
/* ------------------------------------------------------------------ */

describe('buildPhase2Tools · 按 deps 动态注册', () => {
  function makeDeps(overrides: Partial<Phase2ToolsDeps> = {}): Phase2ToolsDeps {
    return {
      memory: {
        async remember() {},
        async recall() {
          return [];
        },
        async getWorkingMemory() {
          return null;
        },
        async setWorkingMemory() {},
        async addPersonaCandidate(c) {
          return { id: 'p1', createdAt: 1, updatedAt: 1, ...c } as PersonaRecord;
        },
      },
      getCurrentVisit: (): PageVisitLike => ({
        visitId: 'v1',
        canonicalUrl: 'https://x',
        domain: 'x',
      }),
      ...overrides,
    };
  }

  it('有 recall 且 memory 支持 Persona → 12 个 tool', () => {
    const tools = buildPhase2Tools({
      ...makeDeps(),
      recall: async () => ({ hit: false, text: '', count: 0 }),
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain('recall_memory');
    expect(names).toContain('remember_persona');
    expect(tools.length).toBe(12); // MVP 3 + WM 7 + recall + persona
  });

  it('没 recall → 少一个 tool', () => {
    const tools = buildPhase2Tools(makeDeps());
    expect(tools.map((t) => t.name)).not.toContain('recall_memory');
  });

  it('memory 不支持 Persona → 不注册 remember_persona', () => {
    const deps = makeDeps();
    const memoryWithoutPersona: MemoryStore = {
      async remember() {},
      async recall() {
        return [];
      },
      async getWorkingMemory() {
        return null;
      },
      async setWorkingMemory() {},
    };
    const tools = buildPhase2Tools({ ...deps, memory: memoryWithoutPersona });
    expect(tools.map((t) => t.name)).not.toContain('remember_persona');
  });
});
