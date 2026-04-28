/**
 * clear_todos · 清空当前 WorkingMemory 的 TODO 列表
 * ---------------------------------------------
 * 保留 activeGoal；只清 todos。用于"本页任务已全部完成，准备开启新话题"。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type { WorkingMemoryRecord } from '@doc-assistant/memory';
import type { WorkingMemoryToolDeps, WMToolResult } from './deps';
import { resolveVisitAndMemory } from './deps';

interface ClearTodosArgs {
  /* 无参数 */
}

interface ClearTodosOk {
  clearedCount: number;
}

export function createClearTodosTool(
  deps: WorkingMemoryToolDeps,
): ToolDefinition<ClearTodosArgs, WMToolResult<ClearTodosOk>> {
  return {
    name: 'clear_todos',
    description:
      '清空当前页面 WorkingMemory 的 TODO 列表，但保留 activeGoal。\n\n**触发时机**：当前任务彻底变向、用户明确要求"重新规划"、或所有 TODO 都已完成后想重新拆分子任务时调用。\n\n**不要调用**：\n- 只是完成了某几条（用 complete_todo 逐条处理）。\n- 只是想删除某一条（用 update_todo 设为 skipped）。\n- 不确定时——宁可不清。\n\n无参数。',
    parametersJsonSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    async execute() {
      const resolved = resolveVisitAndMemory(deps);
      if (!resolved.ok) return resolved;
      const { visit, now } = resolved;
      try {
        const record = await deps.memory.getWorkingMemory(visit.canonicalUrl);
        if (!record) return { ok: true, clearedCount: 0 };
        const clearedCount = record.todos.length;
        const next: WorkingMemoryRecord = {
          ...record,
          todos: [],
          updatedAt: now,
          lastAccessedAt: now,
        };
        await deps.memory.setWorkingMemory(next);
        return { ok: true, clearedCount };
      } catch (err) {
        return { ok: false, error: `clear_todos 失败：${(err as Error).message}` };
      }
    },
  };
}
