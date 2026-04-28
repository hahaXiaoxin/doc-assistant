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
    description:
      '把 WorkingMemory 中的一条 TODO 标记为已完成（status=done）。适用场景：你刚完成一个 subtask（给出答案、读完一段代码、整理完一张表），立即调用以保持 TODO 列表实时反映当前进度。每完成一条都要调，不要等全部做完再一次性清。id 来自 get_working_memory 的返回结果。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '要标记完成的 TODO id（来自 get_working_memory）',
        },
        notes: {
          type: 'string',
          description: '可选：完成备注，写下结论/产出/遇到的意外（例："已通过阅读第 3 节找到答案"）',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    async execute(args) {
      const resolved = resolveVisitAndMemory(deps);
      if (!resolved.ok) return resolved;
      const { visit, now } = resolved;
      try {
        const record = await deps.memory.getWorkingMemory(visit.canonicalUrl);
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
        await deps.memory.setWorkingMemory(next);
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
