/**
 * set_active_goal · 设置当前页面的 activeGoal
 * ---------------------------------------------
 * activeGoal 是 WorkingMemory 的顶层目标描述，比 TODO 粒度更大。
 * 例："整理本文中所有 React Hooks 的使用场景并生成对照表"。
 *
 * 入参：goal（空串或 null 表示清除）。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type { WorkingMemoryRecord } from '@doc-assistant/memory';
import type { WorkingMemoryToolDeps, WMToolResult } from './deps';
import { emptyWorkingMemory, resolveVisitAndMemory } from './deps';

interface SetActiveGoalArgs {
  goal: string;
}

interface SetActiveGoalOk {
  activeGoal: string | null;
}

export function createSetActiveGoalTool(
  deps: WorkingMemoryToolDeps,
): ToolDefinition<SetActiveGoalArgs, WMToolResult<SetActiveGoalOk>> {
  return {
    name: 'set_active_goal',
    description:
      '设置当前页面 WorkingMemory 的 activeGoal（顶层目标描述，建议一句话）。传空字符串会清除 goal。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: '目标描述；空串表示清除' },
      },
      required: ['goal'],
      additionalProperties: false,
    },
    async execute(args) {
      const resolved = resolveVisitAndMemory(deps);
      if (!resolved.ok) return resolved;
      const { visit, now } = resolved;
      const goal = (args.goal ?? '').trim();
      try {
        const existing = (await deps.memory.getWorkingMemory!(visit.canonicalUrl)) ?? null;
        const base: WorkingMemoryRecord = existing ?? emptyWorkingMemory(visit, now);
        const next: WorkingMemoryRecord = {
          ...base,
          activeGoal: goal || undefined,
          updatedAt: now,
          lastAccessedAt: now,
        };
        await deps.memory.setWorkingMemory!(next);
        return { ok: true, activeGoal: next.activeGoal ?? null };
      } catch (err) {
        return { ok: false, error: `set_active_goal 失败：${(err as Error).message}` };
      }
    },
  };
}
