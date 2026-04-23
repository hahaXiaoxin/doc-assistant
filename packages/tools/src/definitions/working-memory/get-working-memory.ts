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
      '读取当前网页的 WorkingMemory（activeGoal + TODO 列表）。\n\n**主动触发的时机**：\n- 用户刚刷新页面或打开 sidebar，问"上次我们做到哪了"、"继续"、"接着聊"——先读 WorkingMemory，看看 activeGoal 和 pending TODO 是什么，再自然接续。\n- 你打算 update_todo / complete_todo 但不确定当前有哪些 TODO（需要先拿 id）。\n\n**不要调用**：activeGoal 已经通过 system 段注入过（你能看到"# 当前工作记忆"），大部分情况下无需再 get；只有系统提示里没有 WorkingMemory 段落且你怀疑有历史任务时才需要显式调用。',
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
          todos: record.todos.map((t) => {
            const entry: {
              id: string;
              content: string;
              status: string;
              priority?: string;
              notes?: string;
              updatedAt: number;
            } = {
              id: t.id,
              content: t.content,
              status: t.status,
              updatedAt: t.updatedAt,
            };
            if (t.priority !== undefined) entry.priority = t.priority;
            if (t.notes !== undefined) entry.notes = t.notes;
            return entry;
          }),
          updatedAt: record.updatedAt,
          lastAccessedAt: record.lastAccessedAt,
        };
      } catch (err) {
        return { ok: false, error: `读取 WorkingMemory 失败：${(err as Error).message}` };
      }
    },
  };
}
