/**
 * recall_memory · 主 LLM 主动召回过去对话/摘要
 * ---------------------------------------------
 * v0.2.1 · 依赖注入一个 `recallRunner(query, mode): Promise<text>`，不直接依赖 agent/recall
 * 的完整实现，避免 tools 包反向依赖 agent（分层约束）。
 *
 * v0.2.3 · 新增"时间维元查询"识别：
 *   当 query 形如"今天/昨天/本周看了哪些/做了什么"这类**元查询**时，
 *   现有语义向量召回无能为力（embedding 基于内容而非时间），直接返回结构化提示，
 *   让主 LLM 知道"这是能力限制、不是数据缺失"，避免误报"未找到"。
 *   完整的时间维记忆检索在 ROADMAP · 未排期 · Chronological Index 中跟进。
 *
 * 主 LLM 用法：
 *   recall_memory({ query: "用户上次问的 agent loop 是怎么设计的", mode: "explicit" })
 *
 * 返回：已格式化好的文本段（由 agent 层的 renderRecallMatches 生成），或"未找到相关记忆"，
 *       或"暂不支持时间维检索"的明确提示。
 */
import type { ToolDefinition } from '@doc-assistant/shared';

export interface RecallMemoryToolDeps {
  /**
   * agent 层注入的召回执行器。传入 query 与 mode（默认 'explicit' —— 跳过代码粗判直接走向量），
   * 返回已经拼装好的文本（若没命中返回空串）。
   */
  recall: (args: {
    query: string;
    mode?: 'auto' | 'explicit';
    limit?: number;
  }) => Promise<{ hit: boolean; text: string; count: number }>;
}

interface RecallMemoryArgs {
  query: string;
  limit?: number;
  mode?: 'auto' | 'explicit';
}

type RecallMemoryResult =
  | { ok: true; hit: false; message: string }
  | { ok: true; hit: true; count: number; content: string }
  | { ok: false; error: string; reason?: 'time_query_unsupported' };

/**
 * 判断 query 是否是"时间维元查询"（现有语义召回无法处理）。
 * 特征：同时出现"时间锚点词"与"列举/查询词"。
 *
 * 纯正则判断，零 LLM 调用、零延迟。匹配保守——只 catch 高置信场景，避免误伤
 * "上次我们聊的那个方案"这种正常召回请求。
 */
export function detectTimeScopedMetaQuery(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  // 时间锚点：今天/昨天/前天/本周/上周/本月/最近 N 天/过去 N 小时/这几天 等
  const TIME_ANCHOR = [
    '今天',
    '昨天',
    '前天',
    '本周',
    '上周',
    '这周',
    '这几天',
    '本月',
    '上个月',
    '最近',
    '刚刚',
    '今早',
    '今晚',
    '下午',
    '晚上',
    'today',
    'yesterday',
    'this week',
    'last week',
    'this month',
    'recently',
  ];
  // 列举/元查询词：看了/读了/聊了/做了/哪些/什么（通常跟在"X 了"后面）/有哪些
  const META_QUERY = [
    '看了哪',
    '看了什么',
    '读了哪',
    '读了什么',
    '聊了哪',
    '聊了什么',
    '讨论了',
    '问过',
    '做了什么',
    '做了哪',
    '有哪些',
    '都看过',
    '都聊过',
    '都读过',
    'what did',
    'which articles',
    'list.*articles',
  ];
  const lower = q.toLowerCase();
  const hasAnchor = TIME_ANCHOR.some((k) => lower.includes(k.toLowerCase()));
  if (!hasAnchor) return false;
  const hasMeta = META_QUERY.some((k) => {
    if (k.includes('.*')) return new RegExp(k, 'i').test(lower);
    return lower.includes(k.toLowerCase());
  });
  return hasMeta;
}

export function createRecallMemoryTool(
  deps: RecallMemoryToolDeps,
): ToolDefinition<RecallMemoryArgs, RecallMemoryResult> {
  return {
    name: 'recall_memory',
    description:
      '从用户过去的对话摘要里按语义召回相关内容。这是跨会话、跨页面的长期记忆检索入口。\n\n**主动触发的时机**：\n- 用户提到"上次/之前/还记得/我们聊过"等明确指向过去的线索。\n- 你在回答前判断"这个话题我们以前应该讨论过"（例如用户突然问"那个方案最后定下来了吗"，而当前对话里没有这个方案）。\n- 用户在新页面提起了一个似乎在其他页面讨论过的概念。\n\n**不要调用**：\n- 当前对话里已经有答案（直接引用 history 即可）。\n- 仅凭当前页面 read_page_content 就能回答的问题。\n- 闲聊 / 新话题。\n\n**重要能力限制**：本 tool 基于**语义向量**召回，不支持**按时间检索**的元查询（例如"今天看了哪些文章"、"本周读了什么"、"最近都聊了什么"）。如果用户问这类问题，本 tool 会返回明确提示，你应当坦诚告诉用户"这类按时间列清单的查询我目前还做不到，但如果你记得某个关键词，我可以帮你找"。\n\n**query 的写法**：建议 10-30 字，包含核心实体/概念。不要把用户整句原话丢进来。例：用户说"上次我们聊的那个兜底机制是怎么实现的" → query 写"agent loop 最后一轮兜底机制"。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            '召回查询：10-30 字的自然语言，围绕核心实体/主题。越具体命中率越高',
          minLength: 1,
        },
        limit: {
          type: 'integer',
          description: '最多返回的 visit_summary 条数，默认 3',
          minimum: 1,
          maximum: 10,
        },
        mode: {
          type: 'string',
          enum: ['auto', 'explicit'],
          description:
            'explicit=直接走向量召回（默认，你主动调用时用这个）；auto=先走关键词粗判+aux 精判（主要供系统自动触发使用）',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(args) {
      const query = (args.query ?? '').trim();
      if (!query) return { ok: false, error: 'query 不能为空' };

      // v0.2.3：时间维元查询的"无能力"提示（避免返回假阴性的"未找到"）
      if (detectTimeScopedMetaQuery(query)) {
        return {
          ok: false,
          reason: 'time_query_unsupported',
          error:
            '当前不支持按时间范围检索记忆（如"今天看了哪些文章"、"本周读了什么"）。当前的 recall_memory 基于语义向量召回，无法处理这类时间维元查询。请坦诚向用户说明这个能力限制；如果用户能回忆起具体的主题/关键词，可以基于关键词再次尝试 recall_memory。',
        };
      }

      try {
        const out = await deps.recall({
          query,
          mode: args.mode ?? 'explicit',
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
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
