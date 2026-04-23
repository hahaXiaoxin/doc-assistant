/**
 * recallMemory · 召回入口函数
 * ---------------------------------------------
 * v0.2.1 · 把 recall-triggers → aux-intent → 向量召回 串成一个可复用的单元。
 *
 * 调用者：
 * - `RelevantMemorySource.gather()`（自动召回路径：每次 user 发送时触发）
 * - `recall_memory` tool（主 LLM 主动路径）
 * - `/recall <query>` 命令（用户显式路径）
 *
 * 流程：
 *   1) 代码粗判（可选，自动路径调用）：detectRecallTrigger(userInput)
 *   2) aux-intent 精判（可选，只在自动路径启用）：callAuxIntent → 'no' 则终止
 *   3) 向量召回：memory.recall({ semantic, types:['visit_summary'], limit })
 *   4) 邻居上下文拼接：对每条 visit_summary 按 visitId 取 episodes_msg 附近 orderInVisit 的前后 2 条
 *
 * 参数 `mode` 决定要不要做 1) / 2)：
 * - 'auto'：粗判 + 精判（默认）
 * - 'explicit'：跳过 1)、2)，直接走向量召回（用户 /recall 或主 LLM 主动调 tool）
 *
 * 返回：
 * - matches: visit_summary 的记录列表
 * - neighbors: 与 matches[i] 同 visitId 的临近 episodes_msg（按 orderInVisit 排序）
 *
 * 失败降级：
 * - aux 精判抛错 / 返回 no → 空结果
 * - memory.recall 抛错 → 空结果（仅日志）
 */
import type { LLMProvider } from '@doc-assistant/provider';
import type { MemoryRecord, MemoryStore } from '@doc-assistant/memory';
import type { ChatMessage } from '@doc-assistant/shared';
import { createLogger } from '@doc-assistant/shared';
import { callAuxIntent } from '../aux/intent';
import { buildRecentHistoryHint, detectRecallTrigger } from './recall-triggers';

const logger = createLogger('agent:recall');

export type RecallMode = 'auto' | 'explicit';

export interface RecallInput {
  query: string;
  /** 触发模式；'explicit' 绕过粗判+精判 */
  mode?: RecallMode;
  /** 最多返回的 visit_summary 条数，默认 3 */
  limit?: number;
  /** 每条 summary 对应拼接多少条邻居消息（各取左右 N）；默认 2 */
  neighborWindow?: number;
  /** 当 mode='auto' 时提供，用于 aux 精判 */
  history?: ReadonlyArray<ChatMessage>;
  /** 外部 AbortSignal */
  signal?: AbortSignal;
}

export interface RecallNeighbor {
  visitId: string;
  orderInVisit: number;
  role?: string;
  content: string;
}

export interface RecallMatch {
  summary: MemoryRecord;
  neighbors: RecallNeighbor[];
}

export interface RecallOutcome {
  hit: boolean;
  /** 触发阶段：'keyword_miss' | 'intent_no' | 'empty_result' | 'success' | 'error' */
  stage: 'keyword_miss' | 'intent_no' | 'empty_result' | 'success' | 'error';
  matches: RecallMatch[];
  error?: string;
}

export interface RecallDeps {
  memory: MemoryStore;
  /** 可选：有则 mode='auto' 时走 aux 精判；没有则退化到直接向量召回 */
  aux?: LLMProvider | null;
}

export async function recallMemory(
  deps: RecallDeps,
  input: RecallInput,
): Promise<RecallOutcome> {
  const {
    query,
    mode = 'auto',
    limit = 3,
    neighborWindow = 2,
    history,
    signal,
  } = input;
  const trimmed = (query ?? '').trim();
  if (!trimmed) {
    return { hit: false, stage: 'empty_result', matches: [] };
  }

  // 1) 粗判（仅 auto 模式）
  if (mode === 'auto') {
    const trigger = detectRecallTrigger(trimmed);
    if (!trigger.hit) {
      return { hit: false, stage: 'keyword_miss', matches: [] };
    }
    // 2) 精判（仅 auto 模式且有 aux）
    if (deps.aux) {
      const intent = await callAuxIntent(deps.aux, {
        userMessage: trimmed,
        recentHistoryHint: history ? buildRecentHistoryHint(history) : undefined,
        signal,
      });
      if (intent.intent === 'no') {
        logger.info('aux-intent 判定 no，跳过召回', { trigger: trigger.matchedText });
        return { hit: false, stage: 'intent_no', matches: [] };
      }
    }
  }

  // 3) 向量召回（走 MemoryStore.recall；其实现内部按 embedQuery 走向量，否则关键词兜底）
  let candidates: MemoryRecord[] = [];
  try {
    candidates = await deps.memory.recall({
      semantic: trimmed,
      types: ['visit_summary'],
      limit,
    });
  } catch (err) {
    logger.warn('memory.recall 失败', (err as Error).message);
    return {
      hit: false,
      stage: 'error',
      matches: [],
      error: (err as Error).message,
    };
  }

  if (candidates.length === 0) {
    return { hit: false, stage: 'empty_result', matches: [] };
  }

  // 4) 为每条 summary 取邻居 episodes_msg
  const matches: RecallMatch[] = [];
  for (const summary of candidates) {
    const neighbors = summary.visitId
      ? await loadNeighbors(deps.memory, summary.visitId, neighborWindow)
      : [];
    matches.push({ summary, neighbors });
  }
  return { hit: true, stage: 'success', matches };
}

async function loadNeighbors(
  memory: MemoryStore,
  visitId: string,
  window: number,
): Promise<RecallNeighbor[]> {
  try {
    // 借用 recall API 拉该 visit 的消息记录（按 timestamp 倒序），之后再按 orderInVisit 正序取头尾
    const list = await memory.recall({ types: ['message'], limit: 200 });
    const sameVisit = list.filter((r) => r.visitId === visitId);
    sameVisit.sort((a, b) => (a.orderInVisit ?? 0) - (b.orderInVisit ?? 0));
    // 取前后 2*window 条：开头 window 条 + 结尾 window 条（中间可能是正文）
    // 这里按照"展示代表性"的直觉：前 window + 后 window
    if (sameVisit.length === 0) return [];
    const pickIndices = new Set<number>();
    for (let i = 0; i < Math.min(window, sameVisit.length); i++) pickIndices.add(i);
    for (let i = Math.max(0, sameVisit.length - window); i < sameVisit.length; i++) {
      pickIndices.add(i);
    }
    return Array.from(pickIndices)
      .sort((a, b) => a - b)
      .map((i) => {
        const r = sameVisit[i]!;
        const neighbor: RecallNeighbor = {
          visitId: r.visitId ?? visitId,
          orderInVisit: r.orderInVisit ?? i,
          content: (r.content ?? '').slice(0, 200),
        };
        if (r.role !== undefined) neighbor.role = r.role;
        return neighbor;
      });
  } catch (err) {
    logger.warn('loadNeighbors 失败', (err as Error).message);
    return [];
  }
}
