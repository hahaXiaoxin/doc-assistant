/**
 * RelevantMemorySource · 召回记忆并注入 system 段
 * ---------------------------------------------
 * v0.2.1 · priority=40（在 WorkingMemory(50) 与 ChatHistory(10) 之间）
 *
 * 触发：每次 agent.run() 的上下文组装阶段自动调用；内部走 recall-triggers 粗判避免滥用 aux。
 *
 * 产出：若命中则输出一段 system 消息，内容结构化地呈现：
 *   # 相关历史记忆（自动召回）
 *   - 摘要: ... (tags: a, b, c)
 *     其中的对话片段：
 *       用户: ...
 *       助手: ...
 *
 * 注意：
 * - Source 内部 fire-and-forget 并**等待**结果（并非异步后台）；因为 LLM 需要
 *   在本轮就拿到召回结果；但整个链路（粗判→aux→向量）是毫秒级，不阻塞用户体验。
 * - aux 精判的延迟可控（超时 8s 见 callAuxIntent 实现）；若用户对延迟敏感，
 *   可通过 options.enableAuxIntent=false 关闭，只走粗判+向量。
 */
import type { LLMProvider } from '@doc-assistant/provider';
import type { MemoryStore } from '@doc-assistant/memory';
import { createLogger } from '@doc-assistant/shared';
import type { AgentInvokeContext, ContextSegment, ContextSource } from './source';
import { recallMemory, type RecallMatch } from './recall';

const logger = createLogger('agent:context:relevant-memory');

export interface RelevantMemorySourceOptions {
  /** 每次最多注入 N 条 visit_summary；默认 3 */
  limit?: number;
  /** 每条 summary 附带的邻居消息数（前/后各 N 条）；默认 2 */
  neighborWindow?: number;
  /** 是否启用 aux 精判；默认 true（要求传入 aux） */
  enableAuxIntent?: boolean;
}

export function createRelevantMemorySource(
  memory: MemoryStore | null | undefined,
  aux: LLMProvider | null | undefined,
  options: RelevantMemorySourceOptions = {},
): ContextSource {
  const limit = options.limit ?? 3;
  const neighborWindow = options.neighborWindow ?? 2;
  const enableAuxIntent = options.enableAuxIntent !== false;

  return {
    name: 'relevant-memory',
    priority: 40,
    async gather(ctx: AgentInvokeContext): Promise<ContextSegment | null> {
      if (!memory) return null;
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
