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
    description:
      '修改 WorkingMemory 中已存在的一条 TODO。适用场景：subtask 进行中需要切换状态（如从 pending → in_progress）、补充 notes（例如"遇到阻碍，改用另一种方案"）、或用户调整了措辞。**不要用本 tool 完成 TODO**——用 complete_todo 更直接。id 必须来自最近一次 get_working_memory 返回的结果。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '要修改的 TODO id（来自 get_working_memory 的返回结果）',
        },
        content: {
          type: 'string',
          description: '可选：更新后的任务描述；不传则保留原文',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'skipped'],
          description:
            '可选：更新状态。pending=等待中；in_progress=正在处理；done=已完成（建议用 complete_todo）；skipped=已放弃/不做了',
        },
        priority: {
          type: 'string',
          enum: ['high', 'normal', 'low'],
          description: '可选：调整优先级',
        },
        notes: {
          type: 'string',
          description: '可选：追加/替换备注。记录过程中的发现、阻碍或结论',
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
        await deps.memory.setWorkingMemory(next);
        return { ok: true, todo: updated };
      } catch (err) {
        return { ok: false, error: `update_todo 失败：${(err as Error).message}` };
      }
    },
  };
}
