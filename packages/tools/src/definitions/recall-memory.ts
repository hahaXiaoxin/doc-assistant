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
      '从用户过去的对话摘要里召回相关内容。当用户提到"上次/之前"等线索或你需要引用过去的讨论时调用。query 建议使用当前问题的关键词或核心实体。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '召回查询（自然语言，建议 10-30 字，指向具体主题/实体）',
          minLength: 1,
        },
        limit: {
          type: 'integer',
          description: '最多返回的 visit_summary 条数（默认 3）',
          minimum: 1,
          maximum: 10,
        },
        mode: {
          type: 'string',
          enum: ['auto', 'explicit'],
          description: 'explicit=直接走向量（默认），auto=先走粗判+aux 精判',
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
