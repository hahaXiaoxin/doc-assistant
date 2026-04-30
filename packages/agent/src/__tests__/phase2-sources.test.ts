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
import {
  NullMemoryStore,
  type MemoryStore,
  type PersonaRecord,
  type SessionTopicRecord,
  type WorkingMemoryRecord,
} from '@doc-assistant/memory';

const DEFAULT_CTX: AgentInvokeContext = {
  userInput: 'hi',
  history: [],
};

function makeMemory(overrides: Partial<MemoryStore> = {}): MemoryStore {
  const base = new NullMemoryStore();
  return Object.assign(base, overrides);
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
          subject: 'user',
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

  it('只有 agent 组时仅注入 # 关于你 段', async () => {
    const mem = makeMemory({
      listPersonas: vi.fn().mockResolvedValue([
        {
          id: 'a1',
          subject: 'agent',
          content: '你叫小瑾,是文档阅读助手',
          status: 'confirmed',
          confidence: 0.9,
          hitCount: 1,
          reviewedByUser: true,
          source: { extractedBy: 'user_explicit' },
          createdAt: 1,
          updatedAt: 1,
        } as PersonaRecord,
      ]),
    });
    const s = createPersonaSource(mem);
    const seg = await s.gather(DEFAULT_CTX);
    const content = String(seg?.message.content ?? '');
    expect(content).toContain('# 关于你');
    expect(content).not.toContain('# 关于用户');
    expect(content).toContain('你叫小瑾');
  });

  it('只有 user 组时仅注入 # 关于用户 段', async () => {
    const mem = makeMemory({
      listPersonas: vi.fn().mockResolvedValue([
        {
          id: 'u1',
          subject: 'user',
          content: '用户是前端工程师',
          status: 'confirmed',
          confidence: 0.9,
          hitCount: 1,
          reviewedByUser: true,
          source: { extractedBy: 'reflection' },
          createdAt: 1,
          updatedAt: 1,
        } as PersonaRecord,
      ]),
    });
    const s = createPersonaSource(mem);
    const seg = await s.gather(DEFAULT_CTX);
    const content = String(seg?.message.content ?? '');
    expect(content).not.toContain('# 关于你');
    expect(content).toContain('# 关于用户');
    expect(content).toContain('用户是前端工程师');
  });

  it('两组都有时分两段注入(agent 段在前 / user 段在后)', async () => {
    const mem = makeMemory({
      listPersonas: vi.fn().mockResolvedValue([
        {
          id: 'u1',
          subject: 'user',
          content: '用户偏好 TypeScript',
          status: 'confirmed',
          confidence: 0.6,
          hitCount: 1,
          reviewedByUser: true,
          source: { extractedBy: 'reflection' },
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'a1',
          subject: 'agent',
          content: '回答优先使用函数式风格',
          status: 'confirmed',
          confidence: 0.9,
          hitCount: 5,
          reviewedByUser: true,
          source: { extractedBy: 'reflection' },
          createdAt: 1,
          updatedAt: 2,
        },
      ] as PersonaRecord[]),
    });
    const s = createPersonaSource(mem);
    const seg = await s.gather(DEFAULT_CTX);
    expect(seg).not.toBeNull();
    expect(seg?.message.role).toBe('system');
    const content = String(seg?.message.content ?? '');
    // 两段都出现
    expect(content).toContain('# 关于你');
    expect(content).toContain('# 关于用户');
    // agent 段排在 user 段之前
    expect(content.indexOf('# 关于你')).toBeLessThan(
      content.indexOf('# 关于用户'),
    );
    // 内容命中
    expect(content).toContain('回答优先使用函数式风格');
    expect(content).toContain('用户偏好 TypeScript');
  });

  it('agentTopK / userTopK 分别限制', async () => {
    const agentPersonas = Array.from({ length: 15 }, (_, i) => ({
      id: `a${i}`,
      subject: 'agent' as const,
      content: `agent-persona-${i}`,
      status: 'confirmed' as const,
      confidence: 1 - i * 0.01,
      hitCount: 1,
      reviewedByUser: true,
      source: { extractedBy: 'reflection' as const },
      createdAt: 1,
      updatedAt: 1,
    }));
    const userPersonas = Array.from({ length: 12 }, (_, i) => ({
      id: `u${i}`,
      subject: 'user' as const,
      content: `user-persona-${i}`,
      status: 'confirmed' as const,
      confidence: 1 - i * 0.01,
      hitCount: 1,
      reviewedByUser: true,
      source: { extractedBy: 'reflection' as const },
      createdAt: 1,
      updatedAt: 1,
    }));
    const mem = makeMemory({
      listPersonas: vi
        .fn()
        .mockResolvedValue([...agentPersonas, ...userPersonas]),
    });
    const s = createPersonaSource(mem, { agentTopK: 2, userTopK: 3 });
    const seg = await s.gather(DEFAULT_CTX);
    const content = String(seg?.message.content ?? '');
    expect(content).toContain('agent-persona-0');
    expect(content).toContain('agent-persona-1');
    expect(content).not.toContain('agent-persona-2');
    expect(content).toContain('user-persona-0');
    expect(content).toContain('user-persona-1');
    expect(content).toContain('user-persona-2');
    expect(content).not.toContain('user-persona-3');
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
    // v0.4.0 修复：每条 TODO 都显式暴露 id，方便 LLM 调 complete_todo({ id })
    expect(content).toContain('{id=t1}');
    expect(content).toContain('{id=t2}');
    // 强指令：complete_todo 推进规则必须出现
    expect(content).toContain('complete_todo');
  });
});
