/**
 * add_todo · 向当前页面的 WorkingMemory 追加一条 TODO
 * ---------------------------------------------
 * 入参：
 * - content (required, ≥1 字符)
 * - priority: 'high' | 'normal' | 'low'，默认 normal
 * - notes: 可选备注
 *
 * 行为：若 WorkingMemory 不存在 → 新建一份再追加。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type { TodoItem, WorkingMemoryRecord } from '@doc-assistant/memory';
import type { WorkingMemoryToolDeps, WMToolResult } from './deps';
import { defaultGenId, emptyWorkingMemory, resolveVisitAndMemory } from './deps';

interface AddTodoArgs {
  content: string;
  priority?: 'high' | 'normal' | 'low';
  notes?: string;
}

interface AddTodoOk {
  todo: TodoItem;
  totalCount: number;
}

export function createAddTodoTool(
  deps: WorkingMemoryToolDeps,
): ToolDefinition<AddTodoArgs, WMToolResult<AddTodoOk>> {
  return {
    name: 'add_todo',
    description:
      '向当前网页的 WorkingMemory 追加一条 TODO。当你识别到一个需要后续处理的子任务时调用。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'TODO 的具体描述', minLength: 1 },
        priority: {
          type: 'string',
          enum: ['high', 'normal', 'low'],
          description: '优先级，默认 normal',
        },
        notes: { type: 'string', description: '可选的补充备注' },
      },
      required: ['content'],
      additionalProperties: false,
    },
    async execute(args) {
      const resolved = resolveVisitAndMemory(deps);
      if (!resolved.ok) return resolved;
      const { visit, now } = resolved;
      const content = (args.content ?? '').trim();
      if (!content) return { ok: false, error: 'content 不能为空' };

      try {
        const existing = (await deps.memory.getWorkingMemory!(visit.canonicalUrl)) ?? null;
        const base: WorkingMemoryRecord = existing ?? emptyWorkingMemory(visit, now);
        const genId = deps.genId ?? defaultGenId;
        const todo: TodoItem = {
          id: genId(),
          content,
          status: 'pending',
          priority: args.priority ?? 'normal',
          createdAt: now,
          updatedAt: now,
          ...(args.notes !== undefined ? { notes: args.notes } : {}),
        };
        const next: WorkingMemoryRecord = {
          ...base,
          todos: [...base.todos, todo],
          updatedAt: now,
          lastAccessedAt: now,
        };
        await deps.memory.setWorkingMemory!(next);
        return { ok: true, todo, totalCount: next.todos.length };
      } catch (err) {
        return { ok: false, error: `add_todo 失败：${(err as Error).message}` };
      }
    },
  };
}
