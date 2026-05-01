/**
 * RelevantMemorySource · 召回记忆并注入 system 段
 * ---------------------------------------------
 * v0.2.1 · priority=40（在 WorkingMemory(50) 与 ChatHistory(10) 之间）
 * v0.4.0 · 新增"时间维元查询"自动路由分支（Chronological Index）
 *
 * 触发：每次 agent.run() 的上下文组装阶段自动调用。
 *
 * 分支路由（v0.4.0 起）：
 *   1) 先调 `detectTimeScopedMetaQuery(userInput)`：
 *      - 命中 → **跳过向量召回**，直接走 `memory.recall({ types:['visit_summary'], timeRange })`
 *        拼成 "# 相关历史记忆（按时间窗自动召回）" system 段注入。这是 LLM 侧显式调用
 *        `list_recent_visits` 之外的"系统侧隐式路由"，让用户感知不到 tool 边界。
 *      - 未命中 → 走原有链路（recall-triggers 粗判 → aux 精判 → 向量召回）
 *   2) priority 保持 40 不变
 *
 * 注意：
 * - Source 内部 fire-and-forget 并**等待**结果；整个链路毫秒级，不阻塞用户体验。
 * - aux 精判的延迟可控（超时 8s 见 callAuxIntent 实现）；
 *   可通过 options.enableAuxIntent=false 关闭，只走粗判+向量。
 */
import type { LLMProvider } from '@doc-assistant/provider';
import type { MemoryRecord, MemoryStore } from '@doc-assistant/memory';
import { createLogger } from '@doc-assistant/shared';
import type { AgentInvokeContext, ContextSegment, ContextSource } from './source';
import { recallMemory, type RecallMatch } from './recall';
import {
  detectTimeScopedMetaQuery,
  resolveTimeRange,
  type TimeRangeKey,
} from './time-query';

const logger = createLogger('agent:context:relevant-memory');

export interface RelevantMemorySourceOptions {
  /** 每次最多注入 N 条 visit_summary；默认 3（语义召回路径） */
  limit?: number;
  /** 每条 summary 附带的邻居消息数（前/后各 N 条）；默认 2 */
  neighborWindow?: number;
  /** 是否启用 aux 精判；默认 true（要求传入 aux） */
  enableAuxIntent?: boolean;
  /** 时间维自动路由命中时最多注入多少条 visit_summary；默认 10 */
  timeWindowLimit?: number;
  /**
   * 时间维自动路由命中时使用哪个预设窗口；默认 'today'。
   * 未来可根据 `detectTimeScopedMetaQuery` 的细分结果动态选取；v0.4.0 先统一用 today。
   */
  timeWindowKey?: Exclude<TimeRangeKey, 'custom'>;
  /** 时间源注入（单测用） */
  getNow?: () => number;
}

export function createRelevantMemorySource(
  memory: MemoryStore | null | undefined,
  aux: LLMProvider | null | undefined,
  options: RelevantMemorySourceOptions = {},
): ContextSource {
  const limit = options.limit ?? 3;
  const neighborWindow = options.neighborWindow ?? 2;
  const enableAuxIntent = options.enableAuxIntent !== false;
  const timeWindowLimit = options.timeWindowLimit ?? 10;
  const timeWindowKey = options.timeWindowKey ?? 'today';
  const getNow = options.getNow ?? ((): number => Date.now());

  return {
    name: 'relevant-memory',
    priority: 40,
    async gather(ctx: AgentInvokeContext): Promise<ContextSegment | null> {
      if (!memory) return null;

      // v0.4.0：时间维元查询自动路由 —— 跳过向量召回，直接按时间窗注入 visit_summary 清单
      if (detectTimeScopedMetaQuery(ctx.userInput)) {
        const { startTs, endTs } = resolveTimeRange(timeWindowKey, {
          now: getNow(),
        });
        let visits: MemoryRecord[] = [];
        try {
          visits = await memory.recall({
            types: ['visit_summary'],
            timeRange: [startTs, endTs],
            limit: timeWindowLimit,
          });
        } catch (err) {
          logger.warn('时间维自动路由 memory.recall 失败', (err as Error).message);
          return null;
        }
        if (visits.length === 0) {
          logger.debug('时间维自动路由：窗口内无 visit_summary', {
            timeWindowKey,
          });
          return null;
        }
        const text = renderTimeWindowVisits(visits, timeWindowKey);
        logger.info(`时间维自动路由命中，注入 ${visits.length} 条 visit_summary`, {
          timeWindowKey,
        });
        return {
          source: 'relevant-memory',
          message: {
            role: 'system',
            content: text,
          },
        };
      }

      // 原有语义召回链路
      const outcome = await recallMemory(
        { memory, aux: enableAuxIntent ? (aux ?? null) : null },
        {
          query: ctx.userInput,
          mode: 'auto',
          limit,
          neighborWindow,
          history: ctx.history,
        },
      );
      if (!outcome.hit || outcome.matches.length === 0) {
        logger.debug('召回未命中', { stage: outcome.stage });
        return null;
      }

      const text = renderRecallMatches(outcome.matches);
      logger.info(`召回命中 ${outcome.matches.length} 条，注入 system 段`, {
        stage: outcome.stage,
      });
      return {
        source: 'relevant-memory',
        message: {
          role: 'system',
          content: text,
        },
      };
    },
  };
}

export function renderRecallMatches(matches: RecallMatch[]): string {
  const lines: string[] = [
    '# 相关历史记忆（自动召回）',
    '以下是从用户过去的对话中召回的相关内容，供你在回答时参考（不要机械复述，而是结合当前问题有所取舍）：',
    '',
  ];
  for (const [i, m] of matches.entries()) {
    const tags = m.summary.topic?.length ? ` (标签: ${m.summary.topic.join(', ')})` : '';
    const when = m.summary.timestamp ? new Date(m.summary.timestamp).toISOString().slice(0, 10) : '';
    lines.push(`${i + 1}. [${when}] ${m.summary.content}${tags}`);
    if (m.neighbors.length > 0) {
      lines.push('   对话片段：');
      for (const n of m.neighbors) {
        const role = n.role === 'user' ? '用户' : n.role === 'assistant' ? '助手' : n.role ?? '消息';
        lines.push(`   - ${role}: ${n.content}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/**
 * 时间维自动路由命中时的渲染：只列 visit_summary，不展示邻居消息。
 */
export function renderTimeWindowVisits(
  visits: readonly MemoryRecord[],
  timeWindowKey: Exclude<TimeRangeKey, 'custom'>,
): string {
  const lines: string[] = [
    '# 相关历史记忆（按时间窗自动召回）',
    `用户问题含时间维关键词，以下是时间窗 [${timeWindowKey}] 内的 visit 摘要清单（按时间倒序）：`,
    '',
  ];
  // memory.recall 无 semantic 时内部已按 timestamp 倒序；此处不再重排，保持契约一致
  visits.forEach((v, i) => {
    const when = v.timestamp ? new Date(v.timestamp).toISOString().slice(0, 16).replace('T', ' ') : '';
    const domain = v.domain ? ` · ${v.domain}` : '';
    const tags = v.topic?.length ? ` (标签: ${v.topic.join(', ')})` : '';
    lines.push(`${i + 1}. [${when}${domain}] ${v.content}${tags}`);
  });
  return lines.join('\n').trimEnd();
}
