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
      '向当前页面的 WorkingMemory 追加一条 TODO。刷新/跨会话后 TODO 仍在，是你"记得接下来要做什么"的主要方式。\n\n**主动触发的时机**：\n- 用户任务已经 set_active_goal 后，你识别出一个具体的子步骤（例如"先读完第 3 节"、"把图 2 的数据整理成表")。\n- 执行过程中发现新的后续工作（"稍后需要比对另一个版本"）。\n- 你主动向用户承诺下一步要做什么时，同步写入，保证不遗漏。\n\n**不要调用**：闲聊、没有 activeGoal 时突然出现的 TODO（请先 set_active_goal 再拆分）、或仅当下一次回复就能解决的"任务"。\n\n当你一次要加多条 subtask（例如开始任务时拆成 3-5 个步骤），**优先用 set_todos 一次性写入**，而不是连续调用 add_todo。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'TODO 的具体动作描述，一句话。例："阅读第 3 节并找出所有代码示例"',
          minLength: 1,
        },
        priority: {
          type: 'string',
          enum: ['high', 'normal', 'low'],
          description:
            '优先级，默认 normal。仅当用户或任务上下文明确表达紧迫（high）/次要（low）时才调整',
        },
        notes: {
          type: 'string',
          description: '可选备注：依赖、背景、验收标准、潜在难点',
        },
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
