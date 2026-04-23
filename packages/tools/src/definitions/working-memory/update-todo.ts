/**
 * update_todo · 修改一条 TODO 的 content/priority/notes/status
 * ---------------------------------------------
 * 与 complete_todo 的区别：complete_todo 只改 status=done；本 tool 支持任意字段修改。
 * id 不存在 → ok:false
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type { TodoItem, TodoStatus, WorkingMemoryRecord } from '@doc-assistant/memory';
import type { WorkingMemoryToolDeps, WMToolResult } from './deps';
import { resolveVisitAndMemory } from './deps';

interface UpdateTodoArgs {
  id: string;
  content?: string;
  status?: TodoStatus;
  priority?: 'high' | 'normal' | 'low';
  notes?: string;
}

interface UpdateTodoOk {
  todo: TodoItem;
}

export function createUpdateTodoTool(
  deps: WorkingMemoryToolDeps,
): ToolDefinition<UpdateTodoArgs, WMToolResult<UpdateTodoOk>> {
  return {
    name: 'update_todo',
    description: '根据 id 修改 WorkingMemory 中的一条 TODO（content/priority/notes/status）。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'TODO 的 id（来自 get_working_memory）' },
        content: { type: 'string' },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'skipped'],
        },
        priority: { type: 'string', enum: ['high', 'normal', 'low'] },
        notes: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    async execute(args) {
      const resolved = resolveVisitAndMemory(deps);
      if (!resolved.ok) return resolved;
      const { visit, now } = resolved;
      try {
        const record = await deps.memory.getWorkingMemory!(visit.canonicalUrl);
        if (!record) return { ok: false, error: '当前页面没有 WorkingMemory，请先 add_todo' };

        const idx = record.todos.findIndex((t) => t.id === args.id);
        if (idx < 0) return { ok: false, error: `未找到 id=${args.id} 的 TODO` };

        const before = record.todos[idx]!;
        const nextPriority = args.priority ?? before.priority;
        const nextNotes = args.notes !== undefined ? args.notes : before.notes;
        const updated: TodoItem = {
          ...before,
          content: args.content?.trim() ? args.content.trim() : before.content,
          status: args.status ?? before.status,
          updatedAt: now,
          ...(nextPriority !== undefined ? { priority: nextPriority } : {}),
          ...(nextNotes !== undefined ? { notes: nextNotes } : {}),
        };
        const nextTodos = [...record.todos];
        nextTodos[idx] = updated;
        const next: WorkingMemoryRecord = {
          ...record,
          todos: nextTodos,
          updatedAt: now,
          lastAccessedAt: now,
        };
        await deps.memory.setWorkingMemory!(next);
        return { ok: true, todo: updated };
      } catch (err) {
        return { ok: false, error: `update_todo 失败：${(err as Error).message}` };
      }
    },
  };
}
