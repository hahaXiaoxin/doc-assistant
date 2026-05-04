/**
 * WorkingMemory Tools · 工厂
 * ---------------------------------------------
 * 返回 7 个细粒度 tool，统一依赖 `WorkingMemoryToolDeps`：
 *   - get_working_memory
 *   - set_todos
 *   - add_todo
 *   - update_todo
 *   - complete_todo
 *   - clear_todos
 *   - set_active_goal
 *
 * 由 agent 层在装配默认 tool 集合时调用：
 *   buildDefaultTools({ memory, getCurrentVisit })
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type { WorkingMemoryToolDeps } from './deps';
import { createGetWorkingMemoryTool } from './get-working-memory';
import { createSetTodosTool } from './set-todos';
import { createAddTodoTool } from './add-todo';
import { createUpdateTodoTool } from './update-todo';
import { createCompleteTodoTool } from './complete-todo';
import { createClearTodosTool } from './clear-todos';
import { createSetActiveGoalTool } from './set-active-goal';

export type { PageVisitLike, WorkingMemoryToolDeps, WMToolResult } from './deps';
export {
  createGetWorkingMemoryTool,
  createSetTodosTool,
  createAddTodoTool,
  createUpdateTodoTool,
  createCompleteTodoTool,
  createClearTodosTool,
  createSetActiveGoalTool,
};

/** 构造全部 7 个 WorkingMemory tool */
export function buildWorkingMemoryTools(deps: WorkingMemoryToolDeps): ToolDefinition[] {
  return [
    createGetWorkingMemoryTool(deps),
    createSetTodosTool(deps),
    createAddTodoTool(deps),
    createUpdateTodoTool(deps),
    createCompleteTodoTool(deps),
    createClearTodosTool(deps),
    createSetActiveGoalTool(deps),
  ];
}
