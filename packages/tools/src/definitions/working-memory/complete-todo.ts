/**
 * complete_todo · 把一条 TODO 标记为 done
 * ---------------------------------------------
 * 语义快捷键：等价于 update_todo({id, status:'done'})，但参数更小、LLM 更易触发。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type { TodoItem, WorkingMemoryRecord } from '@doc-assistant/memory';
import type { WorkingMemoryToolDeps, WMToolResult } from './deps';
import { resolveVisitAndMemory } from './deps';

interface CompleteTodoArgs {
  id: string;
  /** 可选：完成时的备注（如"已通过 search tool 解决"） */
  notes?: string;
}

interface CompleteTodoOk {
  todo: TodoItem;
  remainingPending: number;
}

export function createCompleteTodoTool(
  deps: WorkingMemoryToolDeps,
): ToolDefinition<CompleteTodoArgs, WMToolResult<CompleteTodoOk>> {
  return {
    name: 'complete_todo',
    description: '把一条 TODO 标记为 done。可选 notes 填写完成备注。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
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
        if (!record) return { ok: false, error: '当前页面没有 WorkingMemory' };
        const idx = record.todos.findIndex((t) => t.id === args.id);
        if (idx < 0) return { ok: false, error: `未找到 id=${args.id} 的 TODO` };

        const before = record.todos[idx]!;
        const nextNotes = args.notes !== undefined ? args.notes : before.notes;
        const updated: TodoItem = {
          ...before,
          status: 'done',
          updatedAt: now,
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
        const remainingPending = next.todos.filter(
          (t) => t.status === 'pending' || t.status === 'in_progress',
        ).length;
        return { ok: true, todo: updated, remainingPending };
      } catch (err) {
        return { ok: false, error: `complete_todo 失败：${(err as Error).message}` };
      }
    },
  };
}
