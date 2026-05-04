/**
 * LLM Tool 默认集合
 * ---------------------------------------------
 * `buildDefaultTools(deps)` 按 deps 能力动态注册全部 tool:
 *   - 3 个页面 tool: read_page_content / get_page_identity / get_selection_text
 *   - 7 个 WorkingMemory 细粒度 tool
 *   - remember_persona
 *   - (可选) recall_memory: deps.recallSemantic 存在时加入
 *   - (可选) list_recent_visits: deps.listRecentVisits 存在时加入
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
  createListRecentVisitsTool,
  type ListRecentVisitsToolDeps,
} from './list-recent-visits';
import {
  createRememberPersonaTool,
  type RememberPersonaToolDeps,
} from './remember-persona';

export interface DefaultToolsDeps extends WorkingMemoryToolDeps {
  /**
   * 可选: 语义召回执行器。提供时会注册 `recall_memory` tool;
   * 省略时不注册(例如 memory 未启用向量召回)。
   */
  recallSemantic?: RecallMemoryToolDeps['recallSemantic'];
  /**
   * 可选: 时间维列清单执行器。提供时会注册 `list_recent_visits` tool;
   * 省略时不注册(例如 NullMemoryStore 场景)。
   */
  listRecentVisits?: ListRecentVisitsToolDeps['listRecentVisits'];
  /**
   * 可选: 显式 remember_persona 依赖覆盖项;默认复用 WorkingMemory 的 memory/getCurrentVisit。
   */
  persona?: Partial<RememberPersonaToolDeps>;
}

/**
 * 默认 tool 集合:
 *   read_page_content / get_page_identity / get_selection_text
 *   + 7 个 WorkingMemory tool + remember_persona
 *   + (可选) recall_memory + (可选) list_recent_visits
 */
export function buildDefaultTools(deps: DefaultToolsDeps): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    readPageContentTool,
    getPageIdentityTool,
    getSelectionTextTool,
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
  if (deps.recallSemantic) {
    tools.push(createRecallMemoryTool({ recallSemantic: deps.recallSemantic }));
  }
  if (deps.listRecentVisits) {
    tools.push(
      createListRecentVisitsTool({ listRecentVisits: deps.listRecentVisits }),
    );
  }
  return tools;
}

export { readPageContentTool, getPageIdentityTool, getSelectionTextTool };
export type { ReadPageContentArgs, ReadPageContentResult } from './read-page-content';
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
  type RecallMemoryToolDeps,
  type TimeRangeKey,
} from './recall-memory';
export {
  createListRecentVisitsTool,
  type ListRecentVisitsToolDeps,
  type ListRecentVisitsItem,
} from './list-recent-visits';
export {
  createRememberPersonaTool,
  type RememberPersonaToolDeps,
} from './remember-persona';
