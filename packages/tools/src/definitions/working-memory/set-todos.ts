/**
 * set_todos · 整批替换当前 WorkingMemory 的 TODO 列表
 * ---------------------------------------------
 * 用途：主 LLM 在"开始执行任务前"做一次整体规划，把多个 subtask 一次写入。
 * 会为每个未指定 id 的条目生成 id；已指定 id 的条目保留 id。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type { TodoItem, TodoStatus, WorkingMemoryRecord } from '@doc-assistant/memory';
import type { WorkingMemoryToolDeps, WMToolResult } from './deps';
import { defaultGenId, emptyWorkingMemory, resolveVisitAndMemory } from './deps';

interface SetTodosArgs {
  todos: Array<{
    id?: string;
    content: string;
    status?: TodoStatus;
    priority?: 'high' | 'normal' | 'low';
    notes?: string;
  }>;
}

interface SetTodosOk {
  totalCount: number;
  activeGoal: string | null;
}

export function createSetTodosTool(
  deps: WorkingMemoryToolDeps,
): ToolDefinition<SetTodosArgs, WMToolResult<SetTodosOk>> {
  return {
    name: 'set_todos',
    description:
      '整批替换当前页面 WorkingMemory 的 TODO 列表。适用场景：用户刚提出一个需要多步骤才能完成的任务（例如"帮我梳理这篇文章里所有 React Hook 的使用场景"），你在开始执行前先把任务拆成 3-5 个 subtask 一次性写入。会保留已有的 activeGoal；不会清除其它字段。**如果只是往已有列表追加一条**，请改用 add_todo 而不是本 tool。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description:
            '完整的 TODO 列表（会替换现有 todos）。按执行顺序排列；每一项代表一个独立 subtask。',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: '可选：已存在 TODO 的 id（来自 get_working_memory）；不传则自动生成',
              },
              content: {
                type: 'string',
                description: 'subtask 的具体动作描述，一句话（例："读取正文并摘出所有代码示例"）',
                minLength: 1,
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'done', 'skipped'],
                description: '初始状态。默认 pending；立刻要开始的第一条可设为 in_progress',
              },
              priority: {
                type: 'string',
                enum: ['high', 'normal', 'low'],
                description: '优先级，默认 normal。仅当用户或上下文明确表达紧迫/次要时调整',
              },
              notes: {
                type: 'string',
                description: '可选备注：写下这条 TODO 的背景、依赖或验收标准',
              },
            },
            required: ['content'],
            additionalProperties: false,
          },
        },
      },
      required: ['todos'],
      additionalProperties: false,
    },
    async execute(args) {
      const resolved = resolveVisitAndMemory(deps);
      if (!resolved.ok) return resolved;
      const { visit, now } = resolved;
      try {
        const existing = (await deps.memory.getWorkingMemory!(visit.canonicalUrl)) ?? null;
        const base: WorkingMemoryRecord = existing ?? emptyWorkingMemory(visit, now);
        const genId = deps.genId ?? defaultGenId;
        const todos: TodoItem[] = (args.todos ?? []).map((t) => {
          const content = (t.content ?? '').trim();
          const item: TodoItem = {
            id: t.id ?? genId(),
            content,
            status: t.status ?? 'pending',
            priority: t.priority ?? 'normal',
            createdAt: now,
            updatedAt: now,
          };
          if (t.notes !== undefined) item.notes = t.notes;
          return item;
        });
        if (todos.some((t) => !t.content)) {
          return { ok: false, error: '存在 content 为空的 TODO' };
        }
        const next: WorkingMemoryRecord = {
          ...base,
          todos,
          updatedAt: now,
          lastAccessedAt: now,
        };
        await deps.memory.setWorkingMemory!(next);
        return { ok: true, totalCount: todos.length, activeGoal: next.activeGoal ?? null };
      } catch (err) {
        return { ok: false, error: `set_todos 失败：${(err as Error).message}` };
      }
    },
  };
}
