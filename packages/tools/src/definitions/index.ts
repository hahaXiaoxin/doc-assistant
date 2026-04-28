/**
 * LLM Tool 默认集合
 * ---------------------------------------------
 * - `buildDefaultMVPTools()`：MVP 的 3 个 tool（读页面 / 页面身份 / 划词文本）。
 * - `buildPhase2Tools(deps)`：在 MVP 3 个基础上追加：
 *    - WorkingMemory 的 7 个细粒度 tool
 *    - remember_persona
 *    - （可选）recall_memory：deps.recall 存在时加入
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import { readPageContentTool } from './read-page-content';
import { getPageIdentityTool } from './get-page-identity';
import { getSelectionTextTool } from './get-selection-text';
import {
  buildWorkingMemoryTools,
  type WorkingMemoryToolDeps,
} from './working-memory';
import {
  createRecallMemoryTool,
  type RecallMemoryToolDeps,
} from './recall-memory';
import {
  createRememberPersonaTool,
  type RememberPersonaToolDeps,
} from './remember-persona';

export function buildDefaultMVPTools(): ToolDefinition[] {
  return [readPageContentTool, getPageIdentityTool, getSelectionTextTool];
}

export interface Phase2ToolsDeps extends WorkingMemoryToolDeps {
  /**
   * 可选：召回执行器。提供时会注册 `recall_memory` tool；
   * 省略时不注册（例如 memory 未启用向量召回）。
   */
  recall?: RecallMemoryToolDeps['recall'];
  /**
   * 可选：显式 remember_persona 依赖覆盖项；默认复用 WorkingMemory 的 memory/getCurrentVisit。
   */
  persona?: Partial<RememberPersonaToolDeps>;
}

/**
 * Phase2 tool 集合：
 *   MVP 3 + WorkingMemory 7 + remember_persona + (可选) recall_memory
 */
export function buildPhase2Tools(deps: Phase2ToolsDeps): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    ...buildDefaultMVPTools(),
    ...buildWorkingMemoryTools(deps),
    createRememberPersonaTool({
      memory: deps.memory,
      ...(deps.persona?.getCurrentVisitId !== undefined
        ? { getCurrentVisitId: deps.persona.getCurrentVisitId }
        : { getCurrentVisitId: () => deps.getCurrentVisit()?.visitId }),
      ...(deps.persona?.getNow !== undefined ? { getNow: deps.persona.getNow } : {}),
      ...(deps.persona?.genId !== undefined ? { genId: deps.persona.genId } : {}),
    }),
  ];
  if (deps.recall) {
    tools.push(createRecallMemoryTool({ recall: deps.recall }));
  }
  return tools;
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
export {
  createRecallMemoryTool,
  detectTimeScopedMetaQuery,
  type RecallMemoryToolDeps,
} from './recall-memory';
export {
  createRememberPersonaTool,
  type RememberPersonaToolDeps,
} from './remember-persona';
