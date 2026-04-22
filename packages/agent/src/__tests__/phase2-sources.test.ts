/**
 * 单测：PersonaSource / SessionTopicSource / WorkingMemorySource
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createPersonaSource,
  createSessionTopicSource,
  createWorkingMemorySource,
} from '../context';
import type { AgentInvokeContext } from '../context';
import type {
  MemoryStore,
  PersonaRecord,
  SessionTopicRecord,
  WorkingMemoryRecord,
} from '@doc-assistant/memory';

const DEFAULT_CTX: AgentInvokeContext = {
  userInput: 'hi',
  history: [],
};

function makeMemory(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    remember: vi.fn(),
    recall: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('PersonaSource · priority=60', () => {
  it('priority=60 且 name 正确', () => {
    const s = createPersonaSource(makeMemory());
    expect(s.priority).toBe(60);
    expect(s.name).toBe('persona');
  });

  it('memory 为 null 时返回 null', async () => {
    const s = createPersonaSource(null);
    expect(await s.gather(DEFAULT_CTX)).toBeNull();
  });

  it('memory 无 listPersonas 时返回 null', async () => {
    // 构造一个没有 listPersonas 的最小 MemoryStore
    const mem: MemoryStore = {
      remember: vi.fn(),
      recall: vi.fn().mockResolvedValue([]),
    };
    const s = createPersonaSource(mem);
    expect(await s.gather(DEFAULT_CTX)).toBeNull();
  });

  it('无 confirmed persona 时返回 null', async () => {
    const s = createPersonaSource(
      makeMemory({ listPersonas: vi.fn().mockResolvedValue([]) }),
    );
    expect(await s.gather(DEFAULT_CTX)).toBeNull();
  });

  it('未审核 persona 不注入', async () => {
    const mem = makeMemory({
      listPersonas: vi.fn().mockResolvedValue([
        {
          id: '1',
          content: '偏好 TS',
          status: 'confirmed',
          confidence: 0.9,
          hitCount: 3,
          reviewedByUser: false, // 未审核
          source: { extractedBy: 'reflection' },
          createdAt: 1,
          updatedAt: 1,
        } as PersonaRecord,
      ]),
    });
    const s = createPersonaSource(mem);
    expect(await s.gather(DEFAULT_CTX)).toBeNull();
  });

  it('已审核 persona 按 confidence 降序注入，返回 system message', async () => {
    const mem = makeMemory({
      listPersonas: vi.fn().mockResolvedValue([
        {
          id: '1',
          content: '偏好 TypeScript',
          status: 'confirmed',
          confidence: 0.6,
          hitCount: 1,
          reviewedByUser: true,
          source: { extractedBy: 'reflection' },
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: '2',
          content: '喜欢函数式',
          status: 'confirmed',
          confidence: 0.9,
          hitCount: 5,
          reviewedByUser: true,
          source: { extractedBy: 'reflection' },
          createdAt: 1,
          updatedAt: 2,
        },
      ]),
    });
    const s = createPersonaSource(mem);
    const seg = await s.gather(DEFAULT_CTX);
    expect(seg).not.toBeNull();
    expect(seg?.message.role).toBe('system');
    const content = String(seg?.message.content ?? '');
    expect(content).toContain('喜欢函数式'); // confidence 高的排前
    // 检查顺序：函数式先出现，TS 后出现
    expect(content.indexOf('喜欢函数式')).toBeLessThan(content.indexOf('偏好 TypeScript'));
  });

  it('topK 限制生效', async () => {
    const personas = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      content: `persona-${i}`,
      status: 'confirmed' as const,
      confidence: 1 - i * 0.01,
      hitCount: 1,
      reviewedByUser: true,
      source: { extractedBy: 'reflection' as const },
      createdAt: 1,
      updatedAt: 1,
    }));
    const mem = makeMemory({
      listPersonas: vi.fn().mockResolvedValue(personas),
    });
    const s = createPersonaSource(mem, { topK: 3 });
    const seg = await s.gather(DEFAULT_CTX);
    const content = String(seg?.message.content ?? '');
    // 只有前 3 条
    expect(content).toContain('persona-0');
    expect(content).toContain('persona-1');
    expect(content).toContain('persona-2');
    expect(content).not.toContain('persona-3');
  });

  it('listPersonas 抛错时返回 null（不中断 Agent）', async () => {
    const mem = makeMemory({
      listPersonas: vi.fn().mockRejectedValue(new Error('db broken')),
    });
    const s = createPersonaSource(mem);
    expect(await s.gather(DEFAULT_CTX)).toBeNull();
  });
});

describe('SessionTopicSource · priority=55', () => {
  it('priority=55', () => {
    const s = createSessionTopicSource(makeMemory());
    expect(s.priority).toBe(55);
    expect(s.name).toBe('session-topic');
  });

  it('visitId 未传 → null', async () => {
    const s = createSessionTopicSource(
      makeMemory({ getSessionTopic: vi.fn().mockResolvedValue(null) }),
    );
    expect(await s.gather(DEFAULT_CTX)).toBeNull();
  });

  it('有 visitId 但无 topic → null', async () => {
    const s = createSessionTopicSource(
      makeMemory({ getSessionTopic: vi.fn().mockResolvedValue(null) }),
    );
    expect(await s.gather({ ...DEFAULT_CTX, visitId: 'v1' })).toBeNull();
  });

  it('有 topic 时注入 system message', async () => {
    const topic: SessionTopicRecord = {
      visitId: 'v1',
      currentTopic: 'React 并发模式',
      tags: ['react', 'concurrent'],
      updatedAt: 1,
      history: [],
    };
    const s = createSessionTopicSource(
      makeMemory({ getSessionTopic: vi.fn().mockResolvedValue(topic) }),
    );
    const seg = await s.gather({ ...DEFAULT_CTX, visitId: 'v1' });
    expect(seg?.message.role).toBe('system');
    expect(String(seg?.message.content)).toContain('React 并发模式');
    expect(String(seg?.message.content)).toContain('react');
  });

  it('getSessionTopic 抛错 → null', async () => {
    const s = createSessionTopicSource(
      makeMemory({ getSessionTopic: vi.fn().mockRejectedValue(new Error('boom')) }),
    );
    expect(await s.gather({ ...DEFAULT_CTX, visitId: 'v1' })).toBeNull();
  });
});

describe('WorkingMemorySource · priority=50', () => {
  it('priority=50', () => {
    const s = createWorkingMemorySource(makeMemory());
    expect(s.priority).toBe(50);
    expect(s.name).toBe('working-memory');
  });

  it('canonicalUrl 未传 → null', async () => {
    const s = createWorkingMemorySource(
      makeMemory({ getWorkingMemory: vi.fn().mockResolvedValue(null) }),
    );
    expect(await s.gather(DEFAULT_CTX)).toBeNull();
  });

  it('无 WorkingMemory 记录 → null', async () => {
    const s = createWorkingMemorySource(
      makeMemory({ getWorkingMemory: vi.fn().mockResolvedValue(null) }),
    );
    const ctx: AgentInvokeContext = {
      ...DEFAULT_CTX,
      page: { url: 'x', title: 'x', canonicalUrl: 'https://a.com' },
    };
    expect(await s.gather(ctx)).toBeNull();
  });

  it('有记录但 todos 全 done 且无 activeGoal → null', async () => {
    const wm: WorkingMemoryRecord = {
      canonicalUrl: 'https://a.com',
      todos: [
        { id: 't1', content: 'x', status: 'done', createdAt: 1, updatedAt: 1 },
        { id: 't2', content: 'y', status: 'skipped', createdAt: 1, updatedAt: 1 },
      ],
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1,
    };
    const s = createWorkingMemorySource(
      makeMemory({ getWorkingMemory: vi.fn().mockResolvedValue(wm) }),
    );
    const ctx: AgentInvokeContext = {
      ...DEFAULT_CTX,
      page: { url: 'x', title: 'x', canonicalUrl: 'https://a.com' },
    };
    expect(await s.gather(ctx)).toBeNull();
  });

  it('有 activeGoal 或 pending/in_progress todos 时注入', async () => {
    const wm: WorkingMemoryRecord = {
      canonicalUrl: 'https://a.com',
      activeGoal: '彻底理解 useEffect 的 cleanup',
      todos: [
        { id: 't1', content: '看 cleanup 文档', status: 'pending', createdAt: 1, updatedAt: 1 },
        {
          id: 't2',
          content: '写个 demo',
          status: 'in_progress',
          priority: 'high',
          createdAt: 1,
          updatedAt: 1,
        },
        { id: 't3', content: '完成的', status: 'done', createdAt: 1, updatedAt: 1 },
      ],
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1,
    };
    const s = createWorkingMemorySource(
      makeMemory({ getWorkingMemory: vi.fn().mockResolvedValue(wm) }),
    );
    const ctx: AgentInvokeContext = {
      ...DEFAULT_CTX,
      page: { url: 'x', title: 'x', canonicalUrl: 'https://a.com' },
    };
    const seg = await s.gather(ctx);
    expect(seg).not.toBeNull();
    const content = String(seg?.message.content ?? '');
    expect(content).toContain('useEffect 的 cleanup');
    expect(content).toContain('看 cleanup 文档');
    expect(content).toContain('写个 demo');
    expect(content).toContain('[high]'); // 优先级标记
    expect(content).not.toContain('完成的'); // done 不在 prompt
  });
});
