/**
 * PersonaSource · 个性记忆注入
 * ---------------------------------------------
 * v0.2 · priority=60（< ReferenceTag 70，> SessionTopic 55）
 *
 * 读取 reviewedByUser=true + status=confirmed 的 Persona，按 confidence 降序取 Top-10
 * 作为 system prompt 常驻注入。
 *
 * 未确认的 candidate 不进入 prompt（审核后才生效）。
 *
 * 容错：MemoryStore 无 listPersonas 方法（NullStore 或旧版）时返回 null，不贡献段落。
 */
import type { MemoryStore, PersonaRecord } from '@doc-assistant/memory';
import { createLogger } from '@doc-assistant/shared';
import type { AgentInvokeContext, ContextSegment, ContextSource } from './source';

const logger = createLogger('agent:context:persona');

export interface PersonaSourceOptions {
  /** 注入的最大条数 */
  topK?: number;
}

export function createPersonaSource(
  memory: MemoryStore | null | undefined,
  opts: PersonaSourceOptions = {},
): ContextSource {
  const topK = opts.topK ?? 10;
  return {
    name: 'persona',
    priority: 60,
    async gather(_ctx: AgentInvokeContext): Promise<ContextSegment | null> {
      if (!memory?.listPersonas) return null;
      let list: PersonaRecord[];
      try {
        list = await memory.listPersonas({ status: 'confirmed' });
      } catch (err) {
        logger.warn('listPersonas 失败，跳过 Persona 注入:', (err as Error).message);
        return null;
      }
      // 仅注入 reviewedByUser=true 的（含自动 confirmed）
      const eligible = list.filter((p) => p.reviewedByUser && p.content.trim().length > 0);
      if (eligible.length === 0) return null;
      // 按 (confidence, updatedAt) 降序
      eligible.sort(
        (a, b) =>
          b.confidence - a.confidence ||
          (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      );
      const selected = eligible.slice(0, topK);

      const bullets = selected.map((p) => `- ${p.content}`).join('\n');
      return {
        source: 'persona',
        message: {
          role: 'system',
          content:
            '# 关于用户的长期记忆（个性 / 偏好）\n以下事实在过往对话中反复出现并被用户确认，回答时请保持一致：\n' +
            bullets,
        },
      };
    },
  };
}
