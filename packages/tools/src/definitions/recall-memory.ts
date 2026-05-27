/**
 * recall_memory · 主 LLM 主动语义召回
 * ---------------------------------------------
 * v0.4.0 · 两个 tool 分工：
 *   - recall_memory：**语义召回**（基于向量）。可选 timeRange/domain/articleId 做窗内过滤
 *   - list_recent_visits：**时间维元查询**（按时间窗列清单，不走向量）
 *
 * 本 tool 只负责一件事：透传 query + 可选过滤条件给 deps.recallSemantic，
 * 由 agent 层完成向量召回 + 过滤 + 拼装文本。
 *
 * 变更记录（v0.4.0 Breaking）：
 *   - 移除 `mode: 'auto' | 'explicit'` 枚举 —— tools 层不再关心触发模式
 *   - 移除 `time_query_unsupported` 降级分支 —— LLM 应改调 list_recent_visits
 *   - 移除内置的 `detectTimeScopedMetaQuery`（已上移至 packages/agent/src/context/time-query.ts）
 *   - 新增可选参数：timeRange / startTs / endTs / domain / articleId
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import { compact } from '@doc-assistant/shared';

/** 时间窗口键；与 `packages/agent/src/context/time-query.ts` 保持一致 */
export type TimeRangeKey =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'last-week'
  | 'last-7-days'
  | 'custom';

export interface RecallMemoryToolDeps {
  /**
   * agent 层注入的语义召回执行器。可叠加 timeRange / domain / articleId 做窗内过滤，
   * 返回已经拼装好的文本（若没命中返回空串）。
   */
  recallSemantic: (args: {
    query: string;
    timeRange?: TimeRangeKey;
    startTs?: number;
    endTs?: number;
    domain?: string;
    articleId?: string;
    limit?: number;
  }) => Promise<{ hit: boolean; text: string; count: number }>;
}

interface RecallMemoryArgs {
  query: string;
  timeRange?: TimeRangeKey;
  startTs?: number;
  endTs?: number;
  domain?: string;
  articleId?: string;
  limit?: number;
}

type RecallMemoryResult =
  | { ok: true; hit: false; message: string }
  | { ok: true; hit: true; count: number; content: string }
  | { ok: false; error: string };

const TIME_RANGE_VALUES: readonly TimeRangeKey[] = [
  'today',
  'yesterday',
  'this-week',
  'last-week',
  'last-7-days',
  'custom',
] as const;

export function createRecallMemoryTool(
  deps: RecallMemoryToolDeps,
): ToolDefinition<RecallMemoryArgs, RecallMemoryResult> {
  return {
    name: 'recall_memory',
    description:
      '从用户过去的浏览/对话记忆中按**主题/语义**召回内容，用于"上次那个 agent loop 方案"、"我们之前聊的兜底逻辑"等**内容线索**查询。可叠加 timeRange/domain/articleId 做窗内过滤。\n\n**注意**：如果用户问的是"今天/本周看了什么"、"昨天聊了啥"这种**时间维元查询**（内容无关），请改用 list_recent_visits，不要在这里硬塞 query。\n\n**query 的写法**：建议 10-30 字，包含核心实体/概念。不要把用户整句原话丢进来。例：用户说"上次我们聊的那个兜底机制是怎么实现的" → query 写"agent loop 最后一轮兜底机制"。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            "10-30 字自然语言，围绕核心实体/概念。用于'上次那个方案'、'我们之前聊的 agent loop'等**内容线索**查询",
          minLength: 1,
        },
        timeRange: {
          type: 'string',
          enum: [...TIME_RANGE_VALUES],
          description: '可选时间窗过滤。向量召回结果进一步按该窗口做二次过滤',
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
        articleId: {
          type: 'string',
          description: '可选 visit/article id 过滤（定位到某次具体浏览）',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: '返回条数，默认 3',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(args) {
      const query = (args.query ?? '').trim();
      if (!query) return { ok: false, error: 'query 不能为空' };

      if (args.timeRange !== undefined && !TIME_RANGE_VALUES.includes(args.timeRange)) {
        return { ok: false, error: `timeRange 非法：${String(args.timeRange)}` };
      }
      if (args.timeRange === 'custom') {
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
          return { ok: false, error: 'custom 模式 endTs 必须不小于 startTs' };
        }
      }

      try {
        const out = await deps.recallSemantic({
          query,
          ...compact({
            timeRange: args.timeRange,
            startTs: args.startTs,
            endTs: args.endTs,
            domain: args.domain,
            articleId: args.articleId,
            limit: args.limit,
          }),
        });
        if (!out.hit) {
          return { ok: true, hit: false, message: '未在历史记忆中找到相关内容' };
        }
        return { ok: true, hit: true, count: out.count, content: out.text };
      } catch (err) {
        return { ok: false, error: `recall_memory 失败：${(err as Error).message}` };
      }
    },
  };
}
