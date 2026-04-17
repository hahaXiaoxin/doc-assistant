/**
 * MVP 默认 LLM Tool 集合
 * ---------------------------------------------
 * PHASE2: 记忆召回工具（recall_memory / remember_note）会在此处新增。
 * PHASE3: 截图 + OCR 工具会新增。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import { readPageContentTool } from './read-page-content';
import { getPageIdentityTool } from './get-page-identity';
import { getSelectionTextTool } from './get-selection-text';

export function buildDefaultMVPTools(): ToolDefinition[] {
  return [readPageContentTool, getPageIdentityTool, getSelectionTextTool];
}

export { readPageContentTool, getPageIdentityTool, getSelectionTextTool };
