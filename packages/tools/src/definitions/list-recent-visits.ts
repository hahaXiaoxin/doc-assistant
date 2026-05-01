/**
 * list_recent_visits · 按时间窗列出用户最近浏览过的页面摘要清单
 * ---------------------------------------------
 * v0.4.0 · 新增（Chronological Index 的"LLM 显式调用"分支）
 *
 * 与 `recall_memory` 的分工：
 *   - list_recent_visits：**时间维元查询**（"今天/本周/最近看了什么"）。不走向量，
 *     直接用 memory.recall({ types:['visit_summary'], timeRange, domain, limit }) 取清单，
 *     按 timestamp 倒序返回
 *   - recall_memory：**内容/语义召回**（"上次那个方案"、"我们之前聊的 X"）。可叠加
 *     timeRange/domain 做窗内过滤
 *
 * runner 与 `RelevantMemorySource` 的自动路由分支走同一条底层路径
 * （memory.recall + resolveTimeRange），确保 LLM 显式调用与系统隐式路由语义一致。
 */
import type { ToolDefinition } from '@doc-assistant/shared';

/** 时间窗口键；与 `packages/agent/src/context/time-query.ts` 保持一致 */
export type TimeRangeKey =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'last-week'
  | 'last-7-days'
  | 'custom';

/** 单条 visit 的输出结构 */
export interface ListRecentVisitsItem {
  visitId: string;
  url: string;
  title?: string;
  domain?: string;
  summary: string;
  tags: string[];
  timestamp: number;
}

export interface ListRecentVisitsToolDeps {
  listRecentVisits(args: {
    timeRange: TimeRangeKey;
    startTs?: number;
    endTs?: number;
    domain?: string;
    limit?: number;
  }): Promise<{
    count: number;
    visits: ListRecentVisitsItem[];
  }>;
}

interface ListRecentVisitsArgs {
  timeRange: TimeRangeKey;
  startTs?: number;
  endTs?: number;
  domain?: string;
  limit?: number;
}

type ListRecentVisitsResult =
  | { ok: true; count: number; visits: ListRecentVisitsItem[] }
  | { ok: false; error: string };

const TIME_RANGE_VALUES: readonly TimeRangeKey[] = [
  'today',
  'yesterday',
  'this-week',
  'last-week',
  'last-7-days',
  'custom',
] as const;

export function createListRecentVisitsTool(
  deps: ListRecentVisitsToolDeps,
): ToolDefinition<ListRecentVisitsArgs, ListRecentVisitsResult> {
  return {
    name: 'list_recent_visits',
    description:
      '按时间窗列出用户最近浏览过的页面摘要清单（visit_summary），用于"今天看了哪些文章"、"本周读了什么"、"昨天我们聊了啥"等**时间维元查询**。\n\n不走向量召回，直接按 timeRange 取 visit_summary 列表并按时间倒序返回。\n\n如果是"上次那个方案"、"我们之前聊的 X"这种**内容线索**查询，请改用 recall_memory（语义维）。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        timeRange: {
          type: 'string',
          enum: [...TIME_RANGE_VALUES],
          description:
            '时间窗口。today/yesterday/this-week/last-week/last-7-days 为预设窗；custom 时必须同时提供 startTs/endTs',
        },
        startTs: {
          type: 'integer',
          description: 'custom 起点（毫秒时间戳）',
        },
        endTs: {
          type: 'integer',
          description: 'custom 终点（毫秒时间戳）',
        },
        domain: {
          type: 'string',
          description: "可选域名过滤，如 'github.com'",
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: '返回条数，默认 20，上限 50',
        },
      },
      required: ['timeRange'],
      additionalProperties: false,
    },
    async execute(args) {
      const timeRange = args.timeRange;
      if (!timeRange || !TIME_RANGE_VALUES.includes(timeRange)) {
        return { ok: false, error: `timeRange 非法或缺失：${String(timeRange)}` };
      }
      if (timeRange === 'custom') {
        if (
          typeof args.startTs !== 'number' ||
          typeof args.endTs !== 'number'
        ) {
          return {
            ok: false,
            error: 'custom 模式必须同时提供 startTs 与 endTs（毫秒时间戳）',
          };
        }
        if (args.endTs < args.startTs) {
          return {
            ok: false,
            error: 'custom 模式 endTs 必须不小于 startTs',
          };
        }
      }

      let limit = args.limit ?? 20;
      if (!Number.isFinite(limit) || limit < 1) limit = 20;
      if (limit > 50) limit = 50;

      try {
        const out = await deps.listRecentVisits({
          timeRange,
          ...(args.startTs !== undefined ? { startTs: args.startTs } : {}),
          ...(args.endTs !== undefined ? { endTs: args.endTs } : {}),
          ...(args.domain !== undefined ? { domain: args.domain } : {}),
          limit,
        });
        // title 兜底：反思 Job 有可能没写 meta.title（老数据/title 获取失败），
        // 此处用 URL 的 hostname+path 生成可读标题，保证时间维清单不会出现"空标题"条目
        const visits = out.visits.map((v) => {
          const rawTitle = typeof v.title === 'string' ? v.title.trim() : '';
          if (rawTitle.length > 0) return v;
          const fallback = deriveTitleFromUrl(v.url);
          return fallback ? { ...v, title: fallback } : v;
        });
        return { ok: true, count: out.count, visits };
      } catch (err) {
        return {
          ok: false,
          error: `list_recent_visits 失败：${(err as Error).message}`,
        };
      }
    },
  };
}

/**
 * 从 URL 生成 hostname+path 形式的兜底标题。
 * 解析失败返回空串（调用方根据空串决定不写 title 字段）。
 * 例：
 *   https://github.com/foo/bar?x=1 → "github.com/foo/bar"
 *   https://example.com/           → "example.com"
 *   <解析失败>                     → ""
 */
export function deriveTitleFromUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const host = u.hostname;
    const path = u.pathname.replace(/\/+$/, ''); // 去尾 /
    return path ? `${host}${path}` : host;
  } catch {
    return '';
  }
}
