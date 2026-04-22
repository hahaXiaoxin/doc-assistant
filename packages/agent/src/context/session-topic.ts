/**
 * SessionTopicSource · 情景记忆注入
 * ---------------------------------------------
 * v0.2 · priority=55（< Persona 60，> WorkingMemory 50）
 *
 * 读取当前 visitId 对应的 SessionTopic，作为"领域焦点"提示注入 system prompt。
 * 目的（见 test-prompt.md §T1）：告诉 LLM 当前在哪个领域聊，约束注意力领域。
 * 对用户透明 —— 不产生 UI 通知消息。
 *
 * 容错：
 * - visitId 未传 → null
 * - MemoryStore 无 getSessionTopic → null
 * - 没找到记录 → null
 */
import type { MemoryStore } from '@doc-assistant/memory';
import { createLogger } from '@doc-assistant/shared';
import type { AgentInvokeContext, ContextSegment, ContextSource } from './source';

const logger = createLogger('agent:context:session-topic');

export function createSessionTopicSource(
  memory: MemoryStore | null | undefined,
): ContextSource {
  return {
    name: 'session-topic',
    priority: 55,
    async gather(ctx: AgentInvokeContext): Promise<ContextSegment | null> {
      if (!memory?.getSessionTopic) return null;
      const visitId = ctx.visitId;
      if (!visitId) return null;
      try {
        const topic = await memory.getSessionTopic(visitId);
        if (!topic || !topic.currentTopic?.trim()) return null;
        const tagLine = topic.tags?.length ? `\n相关标签：${topic.tags.join(' / ')}` : '';
        return {
          source: 'session-topic',
          message: {
            role: 'system',
            content: `# 当前领域焦点\n当前对话聚焦于：${topic.currentTopic}${tagLine}\n请在此领域范围内思考与回答。`,
          },
        };
      } catch (err) {
        logger.warn('getSessionTopic 失败', (err as Error).message);
        return null;
      }
    },
  };
}
