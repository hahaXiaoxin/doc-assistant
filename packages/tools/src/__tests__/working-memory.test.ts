/**
 * 单测：WorkingMemory 7 个 tool
 * ---------------------------------------------
 * 用 in-memory fake MemoryStore（仅实现 wm 相关方法）覆盖全部分支。
 * 不依赖 Dexie / fake-indexeddb，保持快速。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NullMemoryStore,
  type MemoryStore,
  type WorkingMemoryRecord,
} from '@doc-assistant/memory';
import {
  buildWorkingMemoryTools,
  buildDefaultTools,
  type PageVisitLike,
  type WorkingMemoryToolDeps,
} from '../definitions';

/* ------------------------------------------------------------------ */
/* In-memory fake MemoryStore（仅实现 wm 相关方法）                     */
/* ------------------------------------------------------------------ */

function makeMemory(): MemoryStore & {
  _store: Map<string, WorkingMemoryRecord>;
  touchSpy: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, WorkingMemoryRecord>();
  const touchSpy = vi.fn();
  const base = new NullMemoryStore();
  return Object.assign(base, {
    _store: store,
    touchSpy,
    async getWorkingMemory(canonicalUrl: string): Promise<WorkingMemoryRecord | null> {
      return store.get(canonicalUrl) ?? null;
    },
    async setWorkingMemory(record: WorkingMemoryRecord): Promise<void> {
      store.set(record.canonicalUrl, record);
    },
    async touchWorkingMemory(canonicalUrl: string, at?: number): Promise<void> {
      touchSpy(canonicalUrl, at);
      const r = store.get(canonicalUrl);
      if (r) r.lastAccessedAt = at ?? Date.now();
    },
  });
}

function makeVisit(overrides: Partial<PageVisitLike> = {}): PageVisitLike {
  return {
    visitId: 'v1',
    canonicalUrl: 'https://example.com/article',
    domain: 'example.com',
    articleId: 'a1',
    ...overrides,
  };
}

function makeDeps(
  memory: MemoryStore,
  visit: PageVisitLike | null = makeVisit(),
  overrides: Partial<WorkingMemoryToolDeps> = {},
): WorkingMemoryToolDeps {
  let idCounter = 0;
  return {
    memory,
    getCurrentVisit: () => visit,
    getNow: () => 1_700_000_000_000,
    genId: () => `todo_${++idCounter}`,
    ...overrides,
  };
}

async function runTool<T>(
  tool: ReturnType<typeof buildWorkingMemoryTools>[number],
  args: Record<string, unknown>,
): Promise<T> {
  return (await tool.execute(args, {})) as T;
}

/* ------------------------------------------------------------------ */
/* 工厂行为                                                           */
/* ------------------------------------------------------------------ */

describe('buildWorkingMemoryTools · 工厂', () => {
  it('返回 7 个 tool，name 互不重复', () => {
    const tools = buildWorkingMemoryTools(makeDeps(makeMemory()));
    expect(tools.length).toBe(7);
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(7);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_working_memory',
        'set_todos',
        'add_todo',
        'update_todo',
        'complete_todo',
        'clear_todos',
        'set_active_goal',
      ]),
    );
  });

  it('buildDefaultTools = 3 个页面 tool + 7 个 WorkingMemory tool + remember_persona', () => {
    const tools = buildDefaultTools(makeDeps(makeMemory()));
    expect(tools.length).toBe(11);
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'read_page_content',
        'get_page_identity',
        'get_selection_text',
        'get_working_memory',
        'set_todos',
        'add_todo',
        'update_todo',
        'complete_todo',
        'clear_todos',
        'set_active_goal',
        'remember_persona',
      ]),
    );
  });
});

/* ------------------------------------------------------------------ */
/* 无 visit / 无 memory 能力时返回 ok:false                            */
/* ------------------------------------------------------------------ */

describe('WorkingMemory tools · 边界与降级', () => {
  it('getCurrentVisit 返回 null → ok:false', async () => {
    const tools = buildWorkingMemoryTools(makeDeps(makeMemory(), null));
    const get = tools.find((t) => t.name === 'get_working_memory')!;
    const r = (await runTool(get, {})) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/PageVisit/);
  });

  it('memory 不支持 setWorkingMemory → 写类 tool 返回 ok:false', async () => {
    const readonlyMem = {
      async remember() {},
      async recall() {
        return [];
      },
      async getWorkingMemory() {
        return null;
      },
      // 故意不实现 setWorkingMemory
    } as unknown as MemoryStore;
    const tools = buildWorkingMemoryTools(makeDeps(readonlyMem));
    const addTodo = tools.find((t) => t.name === 'add_todo')!;
    const r = (await runTool(addTodo, { content: 'x' })) as {
      ok: boolean;
      error?: string;
    };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/setWorkingMemory/);
  });
});

/* ------------------------------------------------------------------ */
/* get_working_memory                                                  */
/* ------------------------------------------------------------------ */

describe('get_working_memory', () => {
  it('不存在记录 → 返回空模板且不创建持久化记录', async () => {
    const memory = makeMemory();
    const tools = buildWorkingMemoryTools(makeDeps(memory));
    const r = (await runTool(tools[0]!, {})) as {
      ok: true;
      todos: unknown[];
      activeGoal: null;
      updatedAt: null;
    };
    expect(r.ok).toBe(true);
    expect(r.todos).toEqual([]);
    expect(r.activeGoal).toBeNull();
    expect(memory._store.size).toBe(0); // 只读不应写库
  });

  it('存在记录 → 返回映射后的 todos + 调用 touchWorkingMemory', async () => {
    const memory = makeMemory();
    memory._store.set('https://example.com/article', {
      canonicalUrl: 'https://example.com/article',
      visitId: 'v1',
      todos: [
        {
          id: 't1',
          content: '解析 canonicalUrl',
          status: 'in_progress',
          priority: 'high',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      activeGoal: '完成 wm-tool 设计',
      createdAt: 1,
      updatedAt: 2,
      lastAccessedAt: 2,
      domain: 'example.com',
    });
    const tools = buildWorkingMemoryTools(makeDeps(memory));
    const r = (await runTool(tools[0]!, {})) as {
      ok: true;
      todos: Array<{ id: string; status: string }>;
      activeGoal: string;
    };
    expect(r.activeGoal).toBe('完成 wm-tool 设计');
    expect(r.todos).toHaveLength(1);
    expect(r.todos[0]!.id).toBe('t1');
    expect(memory.touchSpy).toHaveBeenCalledWith('https://example.com/article', 1_700_000_000_000);
  });
});

/* ------------------------------------------------------------------ */
/* add_todo                                                            */
/* ------------------------------------------------------------------ */

describe('add_todo', () => {
  let memory: ReturnType<typeof makeMemory>;
  let tools: ReturnType<typeof buildWorkingMemoryTools>;

  beforeEach(() => {
    memory = makeMemory();
    tools = buildWorkingMemoryTools(makeDeps(memory));
  });

  function addTodo() {
    return tools.find((t) => t.name === 'add_todo')!;
  }

  it('首次 add_todo 会新建 WorkingMemory 记录', async () => {
    const r = (await runTool(addTodo(), { content: '先读完架构图' })) as {
      ok: true;
      todo: { id: string; content: string; priority: string; status: string };
      totalCount: number;
    };
    expect(r.ok).toBe(true);
    expect(r.todo.id).toBe('todo_1');
    expect(r.todo.content).toBe('先读完架构图');
    expect(r.todo.priority).toBe('normal');
    expect(r.todo.status).toBe('pending');
    expect(r.totalCount).toBe(1);
    const saved = memory._store.get('https://example.com/article')!;
    expect(saved.todos).toHaveLength(1);
  });

  it('content 为空 → ok:false', async () => {
    const r = (await runTool(addTodo(), { content: '   ' })) as { ok: boolean };
    expect(r.ok).toBe(false);
  });

  it('priority=high + notes 会保留', async () => {
    const r = (await runTool(addTodo(), {
      content: '读 ROADMAP',
      priority: 'high',
      notes: '重点看 §2',
    })) as { ok: true; todo: { priority: string; notes: string } };
    expect(r.todo.priority).toBe('high');
    expect(r.todo.notes).toBe('重点看 §2');
  });

  it('两次 add_todo → 共 2 条', async () => {
    await runTool(addTodo(), { content: '第一条' });
    const r = (await runTool(addTodo(), { content: '第二条' })) as {
      ok: true;
      totalCount: number;
    };
    expect(r.totalCount).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* set_todos                                                           */
/* ------------------------------------------------------------------ */

describe('set_todos', () => {
  it('整批替换 + 保留 activeGoal', async () => {
    const memory = makeMemory();
    memory._store.set('https://example.com/article', {
      canonicalUrl: 'https://example.com/article',
      activeGoal: '旧目标',
      todos: [{ id: 'old', content: 'old', status: 'pending', createdAt: 1, updatedAt: 1 }],
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1,
      domain: 'example.com',
    });
    const tools = buildWorkingMemoryTools(makeDeps(memory));
    const setTodos = tools.find((t) => t.name === 'set_todos')!;
    const r = (await runTool(setTodos, {
      todos: [
        { content: '新 1', priority: 'high' },
        { content: '新 2', status: 'in_progress' },
      ],
    })) as { ok: true; totalCount: number; activeGoal: string };
    expect(r.totalCount).toBe(2);
    expect(r.activeGoal).toBe('旧目标');
    const saved = memory._store.get('https://example.com/article')!;
    expect(saved.todos.map((t) => t.content)).toEqual(['新 1', '新 2']);
    expect(saved.todos[1]!.status).toBe('in_progress');
  });

  it('空数组合法（清空 todos）', async () => {
    const memory = makeMemory();
    const tools = buildWorkingMemoryTools(makeDeps(memory));
    const setTodos = tools.find((t) => t.name === 'set_todos')!;
    const r = (await runTool(setTodos, { todos: [] })) as {
      ok: true;
      totalCount: number;
    };
    expect(r.totalCount).toBe(0);
  });

  it('存在 content 为空 → ok:false', async () => {
    const memory = makeMemory();
    const tools = buildWorkingMemoryTools(makeDeps(memory));
    const setTodos = tools.find((t) => t.name === 'set_todos')!;
    const r = (await runTool(setTodos, {
      todos: [{ content: 'ok' }, { content: '  ' }],
    })) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* update_todo / complete_todo / clear_todos                           */
/* ------------------------------------------------------------------ */

describe('update_todo / complete_todo / clear_todos', () => {
  async function seed(memory: ReturnType<typeof makeMemory>) {
    memory._store.set('https://example.com/article', {
      canonicalUrl: 'https://example.com/article',
      todos: [
        { id: 'a', content: 'A', status: 'pending', createdAt: 1, updatedAt: 1 },
        { id: 'b', content: 'B', status: 'in_progress', createdAt: 1, updatedAt: 1 },
      ],
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1,
      domain: 'example.com',
    });
  }

  it('update_todo 修改 content + status', async () => {
    const memory = makeMemory();
    await seed(memory);
    const tools = buildWorkingMemoryTools(makeDeps(memory));
    const updateTodo = tools.find((t) => t.name === 'update_todo')!;
    const r = (await runTool(updateTodo, {
      id: 'a',
      content: 'A-updated',
      status: 'done',
    })) as { ok: true; todo: { content: string; status: string } };
    expect(r.todo.content).toBe('A-updated');
    expect(r.todo.status).toBe('done');
  });

  it('update_todo · id 不存在 → ok:false', async () => {
    const memory = makeMemory();
    await seed(memory);
    const tools = buildWorkingMemoryTools(makeDeps(memory));
    const updateTodo = tools.find((t) => t.name === 'update_todo')!;
    const r = (await runTool(updateTodo, { id: 'nope' })) as { ok: boolean };
    expect(r.ok).toBe(false);
  });

  it('complete_todo 返回剩余 pending 数', async () => {
    const memory = makeMemory();
    await seed(memory);
    const tools = buildWorkingMemoryTools(makeDeps(memory));
    const complete = tools.find((t) => t.name === 'complete_todo')!;
    const r = (await runTool(complete, { id: 'a' })) as {
      ok: true;
      todo: { status: string };
      remainingPending: number;
    };
    expect(r.todo.status).toBe('done');
    // 还剩 b（in_progress 也算"未完成"）
    expect(r.remainingPending).toBe(1);
  });

  it('complete_todo · 记录不存在 → ok:false', async () => {
    const memory = makeMemory();
    const tools = buildWorkingMemoryTools(makeDeps(memory));
    const complete = tools.find((t) => t.name === 'complete_todo')!;
    const r = (await runTool(complete, { id: 'a' })) as { ok: boolean };
    expect(r.ok).toBe(false);
  });

  it('clear_todos 清空后保留 activeGoal', async () => {
    const memory = makeMemory();
    await seed(memory);
    memory._store.get('https://example.com/article')!.activeGoal = '保留我';
    const tools = buildWorkingMemoryTools(makeDeps(memory));
    const clear = tools.find((t) => t.name === 'clear_todos')!;
    const r = (await runTool(clear, {})) as { ok: true; clearedCount: number };
    expect(r.clearedCount).toBe(2);
    const saved = memory._store.get('https://example.com/article')!;
    expect(saved.todos).toEqual([]);
    expect(saved.activeGoal).toBe('保留我');
  });

  it('clear_todos · 无记录 → clearedCount=0', async () => {
    const memory = makeMemory();
    const tools = buildWorkingMemoryTools(makeDeps(memory));
    const clear = tools.find((t) => t.name === 'clear_todos')!;
    const r = (await runTool(clear, {})) as { ok: true; clearedCount: number };
    expect(r.clearedCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* set_active_goal                                                     */
/* ------------------------------------------------------------------ */

describe('set_active_goal', () => {
  it('设置新 goal', async () => {
    const memory = makeMemory();
    const tools = buildWorkingMemoryTools(makeDeps(memory));
    const setGoal = tools.find((t) => t.name === 'set_active_goal')!;
    const r = (await runTool(setGoal, { goal: '整理所有 React Hooks' })) as {
      ok: true;
      activeGoal: string;
    };
    expect(r.activeGoal).toBe('整理所有 React Hooks');
    expect(memory._store.get('https://example.com/article')!.activeGoal).toBe(
      '整理所有 React Hooks',
    );
  });

  it('空串清除 goal', async () => {
    const memory = makeMemory();
    memory._store.set('https://example.com/article', {
      canonicalUrl: 'https://example.com/article',
      activeGoal: '旧',
      todos: [],
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1,
      domain: 'example.com',
    });
    const tools = buildWorkingMemoryTools(makeDeps(memory));
    const setGoal = tools.find((t) => t.name === 'set_active_goal')!;
    const r = (await runTool(setGoal, { goal: '   ' })) as {
      ok: true;
      activeGoal: null;
    };
    expect(r.activeGoal).toBeNull();
    expect(memory._store.get('https://example.com/article')!.activeGoal).toBeUndefined();
  });
});
