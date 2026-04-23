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
      '整批替换当前页面 WorkingMemory 的 TODO 列表。用于开始一个新任务时一次性规划。会保留已有的 activeGoal。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string', minLength: 1 },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'done', 'skipped'],
              },
              priority: { type: 'string', enum: ['high', 'normal', 'low'] },
              notes: { type: 'string' },
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
          return {
            id: t.id ?? genId(),
            content,
            status: t.status ?? 'pending',
            priority: t.priority ?? 'normal',
            notes: t.notes,
            createdAt: now,
            updatedAt: now,
          };
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
