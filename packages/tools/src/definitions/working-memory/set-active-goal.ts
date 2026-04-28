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
      '为当前页面设置"正在做什么"的顶层目标（activeGoal）。这是 WorkingMemory 的核心字段，刷新页面 / 跨会话后仍然保留，能让你在新会话里立刻知道"我们之前在做什么"。\n\n**主动触发的时机**（不要等用户命令）：\n- 用户提出一个**跨多轮的阅读/分析任务**时：例如"帮我梳理这篇文章的所有 Hook 使用场景"、"我想把这份文档的重点整理成表格"、"解释一下这个 agent loop 的设计"——立刻调用并写一句话目标。\n- 用户明确表达"我正在研究 X / 想搞懂 Y"时。\n\n**不要调用的情况**：\n- 一次性的问答（"这段代码什么意思"）——这属于单次交互，不是跨轮目标。\n- 闲聊 / 问候 / 纠正措辞。\n\n格式建议：一句完整的祈使或陈述句，20-40 字，包含"做什么 + 产出形态"。例："梳理本文提到的所有 React Hook 并说明各自的典型场景"、"搞清楚这个 agent loop 的兜底机制是怎么设计的"。\n\n传空字符串会清除 goal（任务已完成、或用户主动要求换话题时调用）。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description:
            '目标描述：一句话（20-40 字），陈述/祈使句。空串表示清除当前目标（例如任务完成）。',
        },
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
        const existing = (await deps.memory.getWorkingMemory(visit.canonicalUrl)) ?? null;
        const base: WorkingMemoryRecord = existing ?? emptyWorkingMemory(visit, now);
        const next: WorkingMemoryRecord = {
          ...base,
          updatedAt: now,
          lastAccessedAt: now,
          ...(goal ? { activeGoal: goal } : {}),
        };
        // 空串表示清除：若 base.activeGoal 存在但新 goal 为空，需要手工剔除
        if (!goal && base.activeGoal !== undefined) {
          delete (next as Partial<WorkingMemoryRecord>).activeGoal;
        }
        await deps.memory.setWorkingMemory(next);
        return { ok: true, activeGoal: next.activeGoal ?? null };
      } catch (err) {
        return { ok: false, error: `set_active_goal 失败：${(err as Error).message}` };
      }
    },
  };
}
