/**
 * WorkingMemorySource · 工作记忆注入
 * ---------------------------------------------
 * v0.2 · priority=50（< SessionTopic 55，> RelevantMemory 40）
 *
 * 按当前 canonicalUrl 读取 WorkingMemory，将 activeGoal + 未完成 TodoList 注入 system prompt，
 * 让 Agent 知道"当前正在做什么"。
 *
 * 注入规则：
 * - 仅列出 pending / in_progress 的 TODO（done / skipped 不再占 prompt 空间）
 * - 附带 LLM 可用的 tool 提示（set_active_goal / add_todo / complete_todo 等）
 *   —— 但具体 tool 注册在 agent 工厂中，本 Source 只做内容注入
 *
 * 容错：
 * - canonicalUrl 未传 → null
 * - memory 为 null/undefined → null
 * - 无记录或无未完成 TODO 且无 activeGoal → null
 */
import type { MemoryStore, TodoItem } from '@doc-assistant/memory';
import { createLogger } from '@doc-assistant/shared';
import type { AgentInvokeContext, ContextSegment, ContextSource } from './source';

const logger = createLogger('agent:context:working-memory');

export function createWorkingMemorySource(
  memory: MemoryStore | null | undefined,
): ContextSource {
  return {
    name: 'working-memory',
    priority: 50,
    async gather(ctx: AgentInvokeContext): Promise<ContextSegment | null> {
      if (!memory) return null;
      const canonicalUrl = ctx.page?.canonicalUrl;
      if (!canonicalUrl) return null;
      try {
        const wm = await memory.getWorkingMemory(canonicalUrl);
        if (!wm) return null;
        const activeTodos = wm.todos.filter(
          (t) => t.status === 'pending' || t.status === 'in_progress',
        );
        if (!wm.activeGoal && activeTodos.length === 0) return null;

        const lines: string[] = ['# 当前工作记忆（本页的目标与待办）'];
        if (wm.activeGoal) {
          lines.push(`当前目标：${wm.activeGoal}`);
        }
        if (activeTodos.length > 0) {
          lines.push(
            '\n未完成待办（activeTodos，按顺序推进）：',
          );
          lines.push(...activeTodos.map((t, i) => formatTodoLine(t, i)));
          lines.push(
            '\n⚠️ 强制规范：每完成其中一条，**必须立刻**调用 `complete_todo({ id: "<上面列出的 id>" })`。',
          );
          lines.push('不要等一整轮结束再一次性清；也不要只在脑海里标记。未调用 complete_todo 视为违反工作规范。');
        }
        return {
          source: 'working-memory',
          message: { role: 'system', content: lines.join('\n') },
        };
      } catch (err) {
        logger.warn('getWorkingMemory 失败', (err as Error).message);
        return null;
      }
    },
  };
}

function formatTodoLine(t: TodoItem, idx: number): string {
  const mark = t.status === 'in_progress' ? '▶' : '•';
  const prio = t.priority && t.priority !== 'normal' ? ` [${t.priority}]` : '';
  return `${idx + 1}. ${mark} {id=${t.id}} ${t.content}${prio}`;
}
