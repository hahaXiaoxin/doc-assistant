/**
 * recall_memory · 主 LLM 主动召回过去对话/摘要
 * ---------------------------------------------
 * v0.2.1 · 依赖注入一个 `recallRunner(query, mode): Promise<text>`，不直接依赖 agent/recall
 * 的完整实现，避免 tools 包反向依赖 agent（分层约束）。
 *
 * 主 LLM 用法：
 *   recall_memory({ query: "用户上次问的 agent loop 是怎么设计的", mode: "explicit" })
 *
 * 返回：已格式化好的文本段（由 agent 层的 renderRecallMatches 生成），或 "未找到相关记忆"。
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
  | { ok: false; error: string };

export function createRecallMemoryTool(
  deps: RecallMemoryToolDeps,
): ToolDefinition<RecallMemoryArgs, RecallMemoryResult> {
  return {
    name: 'recall_memory',
    description:
      '从用户过去的对话摘要里按语义召回相关内容。这是跨会话、跨页面的长期记忆检索入口。\n\n**主动触发的时机**：\n- 用户提到"上次/之前/还记得/我们聊过"等明确指向过去的线索。\n- 你在回答前判断"这个话题我们以前应该讨论过"（例如用户突然问"那个方案最后定下来了吗"，而当前对话里没有这个方案）。\n- 用户在新页面提起了一个似乎在其他页面讨论过的概念。\n\n**不要调用**：\n- 当前对话里已经有答案（直接引用 history 即可）。\n- 仅凭当前页面 read_page_content 就能回答的问题。\n- 闲聊 / 新话题。\n\n**query 的写法**：建议 10-30 字，包含核心实体/概念。不要把用户整句原话丢进来。例：用户说"上次我们聊的那个兜底机制是怎么实现的" → query 写"agent loop 最后一轮兜底机制"。',
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
