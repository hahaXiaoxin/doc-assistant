/**
 * WorkingMemory Tools · 依赖契约
 * ---------------------------------------------
 * 7 个细粒度 tool 共享的依赖形态。选择"闭包注入"而非 `ctx.meta`：
 * - wm-tool 直接访问 MemoryStore，ctx.meta 会污染 ToolExecutionContext 类型；
 * - 闭包注入单测友好：手搓 `{ memory, getCurrentVisit }` 即可。
 *
 * 分层约束：
 * - tools 包的架构位置在 agent 之下（extension → ui → agent → provider/tools/memory → shared），
 *   所以**不能** import agent 的 PageVisit 类型。
 * - 我们在这里定义一个最小鸭子类型 `PageVisitLike`，字段与 agent 的 PageVisit 完全兼容（结构子类型）。
 */
import type { MemoryStore, WorkingMemoryRecord } from '@doc-assistant/memory';
import { compact } from '@doc-assistant/shared';

/**
 * 与 `packages/agent/src/page-visit/types.PageVisit` 保持结构兼容的最小字段集。
 * Agent 层的 PageVisit 可以直接赋值给本类型（结构子类型）。
 */
export interface PageVisitLike {
  visitId: string;
  canonicalUrl: string;
  articleId?: string;
  domain: string;
}

export interface WorkingMemoryToolDeps {
  memory: MemoryStore;
  /** 返回当前 PageVisit；null 表示尚未开始 visit（tool 会返回 ok:false） */
  getCurrentVisit: () => PageVisitLike | null;
  /** 时间注入（单测用），默认 Date.now */
  getNow?: () => number;
  /** TodoItem.id 生成；单测可注入确定性 id */
  genId?: () => string;
}

/** 统一的 tool 返回值格式：便于主 LLM 解析 */
export type WMToolResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/** 没有 WorkingMemory 时，返回一份空模板（不写入，调用方按需 set） */
export function emptyWorkingMemory(
  visit: PageVisitLike,
  now: number,
): WorkingMemoryRecord {
  return {
    canonicalUrl: visit.canonicalUrl,
    visitId: visit.visitId,
    domain: visit.domain,
    todos: [],
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    ...compact({ articleId: visit.articleId }),
  };
}

/**
 * 检查当前 PageVisit 可用性。memory 能力已在接口层保证必填，无需运行时检查。
 * @param _requireWrite 历史参数，保留占位；v0.3 起默认所有实现都支持读写。
 */
export function resolveVisitAndMemory(
  deps: WorkingMemoryToolDeps,
  _requireWrite = true,
):
  | {
      ok: true;
      visit: PageVisitLike;
      now: number;
    }
  | { ok: false; error: string } {
  const visit = deps.getCurrentVisit();
  if (!visit) {
    return { ok: false, error: '当前没有活跃的 PageVisit，无法操作 WorkingMemory' };
  }
  return { ok: true, visit, now: (deps.getNow ?? Date.now)() };
}

/**
 * 生成 TodoItem.id。默认格式：`todo_<13位时间戳>_<6位随机>`。
 * 单测注入 deps.genId 可替换。
 */
export function defaultGenId(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `todo_${ts}_${rnd}`;
}
