/**
 * get_working_memory · 读取当前页面的 WorkingMemory（TODO + activeGoal）
 * ---------------------------------------------
 * 主 LLM 在开始任务前用它"查看当前有没有未完成的待办"。
 * - 无记录时返回 `ok:true, todos:[], activeGoal:null` —— 让 LLM 知道"可以新建"。
 * - 有记录时附带 updatedAt、lastAccessedAt 便于判断时效。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type { WorkingMemoryToolDeps, WMToolResult } from './deps';
import { resolveVisitAndMemory } from './deps';

interface GetWMArgs {
  /* 无参数 */
}

interface GetWMOk {
  canonicalUrl: string;
  activeGoal: string | null;
  todos: Array<{
    id: string;
    content: string;
    status: string;
    priority?: string;
    notes?: string;
    updatedAt: number;
  }>;
  updatedAt: number | null;
  lastAccessedAt: number | null;
}

export function createGetWorkingMemoryTool(
  deps: WorkingMemoryToolDeps,
): ToolDefinition<GetWMArgs, WMToolResult<GetWMOk>> {
  return {
    name: 'get_working_memory',
    description:
      '读取当前网页的 WorkingMemory（TODO 列表与当前目标 activeGoal）。用于判断本页是否有未完成的任务、当前的目标是什么。无参数。',
    parametersJsonSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    async execute() {
      const resolved = resolveVisitAndMemory(deps, /* requireWrite */ false);
      if (!resolved.ok) return resolved;
      const { visit } = resolved;
      try {
        const record = await deps.memory.getWorkingMemory!(visit.canonicalUrl);
        if (!record) {
          return {
            ok: true,
            canonicalUrl: visit.canonicalUrl,
            activeGoal: null,
            todos: [],
            updatedAt: null,
            lastAccessedAt: null,
          };
        }
        // 刷新 lastAccessedAt（best-effort，失败不中断）
        if (deps.memory.touchWorkingMemory) {
          await deps.memory.touchWorkingMemory(visit.canonicalUrl, resolved.now).catch(() => {});
        }
        return {
          ok: true,
          canonicalUrl: record.canonicalUrl,
          activeGoal: record.activeGoal ?? null,
          todos: record.todos.map((t) => ({
            id: t.id,
            content: t.content,
            status: t.status,
            priority: t.priority,
            notes: t.notes,
            updatedAt: t.updatedAt,
          })),
          updatedAt: record.updatedAt,
          lastAccessedAt: record.lastAccessedAt,
        };
      } catch (err) {
        return { ok: false, error: `读取 WorkingMemory 失败：${(err as Error).message}` };
      }
    },
  };
}
