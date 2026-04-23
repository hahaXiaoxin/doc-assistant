/**
 * LLM Tool 默认集合
 * ---------------------------------------------
 * - `buildDefaultMVPTools()`：v0.1 MVP 的 3 个 tool（读页面 / 页面身份 / 划词文本）。
 * - `buildPhase2Tools(deps)`：v0.2.1 新增。在 MVP 3 个基础上追加 WorkingMemory 的 7 个细粒度 tool。
 *   后续 v0.2.1 继续追加 `recall_memory` / `remember_persona`。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import { readPageContentTool } from './read-page-content';
import { getPageIdentityTool } from './get-page-identity';
import { getSelectionTextTool } from './get-selection-text';
import {
  buildWorkingMemoryTools,
  type WorkingMemoryToolDeps,
} from './working-memory';

export function buildDefaultMVPTools(): ToolDefinition[] {
  return [readPageContentTool, getPageIdentityTool, getSelectionTextTool];
}

/**
 * v0.2.1 Phase2 tool 集合 = MVP 3 + WorkingMemory 7
 * 后续 recall_memory / remember_persona 会在此处追加。
 */
export function buildPhase2Tools(deps: WorkingMemoryToolDeps): ToolDefinition[] {
  return [...buildDefaultMVPTools(), ...buildWorkingMemoryTools(deps)];
}

export { readPageContentTool, getPageIdentityTool, getSelectionTextTool };
export {
  buildWorkingMemoryTools,
  createGetWorkingMemoryTool,
  createSetTodosTool,
  createAddTodoTool,
  createUpdateTodoTool,
  createCompleteTodoTool,
  createClearTodosTool,
  createSetActiveGoalTool,
  type WorkingMemoryToolDeps,
  type PageVisitLike,
  type WMToolResult,
} from './working-memory';
