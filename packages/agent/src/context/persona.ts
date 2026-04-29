/**
 * PersonaSource · Persona 双主体注入
 * ---------------------------------------------
 * v0.2 · priority=60（< ReferenceTag 70，> SessionTopic 55）
 *
 * v0.4.0 语义转向：Persona 的本质是"**定义**"——每条 Persona 都在回答
 * "这是在定义谁"。按 `subject` 字段分为两类：
 *   - `subject='agent'`：对 agent 自身的定义（身份、角色、性格、能力边界、行为方式）
 *   - `subject='user'`：对交流对象的定义（身份、背景、偏好）
 *
 * 注入时**分两段** system message：
 *   - `# 关于你（agent）：...` 指导 agent 扮演对应身份、保持对应性格/行为
 *   - `# 关于用户：...` 让 agent 据此调整术语层级、语气、举例风格
 *
 * 读取 reviewedByUser=true + status=confirmed 的 Persona；未确认的 candidate
 * 不进入 prompt（审核后才生效）。
 *
 * 容错：memory 为 null/undefined 时返回 null；任一组为空则对应段不注入；
 * 两组都空则整个 Source 返回 null（与旧行为一致）。
 */
import type { MemoryStore, PersonaRecord } from '@doc-assistant/memory';
import { createLogger } from '@doc-assistant/shared';
import type { AgentInvokeContext, ContextSegment, ContextSource } from './source';

const logger = createLogger('agent:context:persona');

export interface PersonaSourceOptions {
  /** 对 agent 的定义最多注入多少条（默认 10） */
  agentTopK?: number;
  /** 对 user 的定义最多注入多少条（默认 8） */
  userTopK?: number;
}

export function createPersonaSource(
  memory: MemoryStore | null | undefined,
  opts: PersonaSourceOptions = {},
): ContextSource {
  const agentTopK = opts.agentTopK ?? 10;
  const userTopK = opts.userTopK ?? 8;
  return {
    name: 'persona',
    priority: 60,
    async gather(_ctx: AgentInvokeContext): Promise<ContextSegment | null> {
      if (!memory) return null;
      let list: PersonaRecord[];
      try {
        list = await memory.listPersonas({ status: 'confirmed' });
      } catch (err) {
        logger.warn('listPersonas 失败，跳过 Persona 注入:', (err as Error).message);
        return null;
      }
      // 仅注入 reviewedByUser=true 且内容非空的；按 subject 分组
      const eligible = list.filter(
        (p) => p.reviewedByUser && p.content.trim().length > 0,
      );
      if (eligible.length === 0) return null;

      const byConfidence = (a: PersonaRecord, b: PersonaRecord): number =>
        b.confidence - a.confidence || (b.updatedAt ?? 0) - (a.updatedAt ?? 0);

      const agentList = eligible
        .filter((p) => p.subject === 'agent')
        .sort(byConfidence)
        .slice(0, agentTopK);
      const userList = eligible
        .filter((p) => p.subject === 'user')
        .sort(byConfidence)
        .slice(0, userTopK);

      if (agentList.length === 0 && userList.length === 0) return null;

      const segments: string[] = [];
      if (agentList.length > 0) {
        segments.push(
          '# 关于你（agent）：以下是对你自己的定义,请据此设定身份、性格与行为方式\n' +
            '以下条目定义了"你是谁"（来自过往对话沉淀，已由用户审核通过）。在本次对话中请据此扮演对应身份、保持对应性格与行为方式：\n' +
            agentList.map((p) => `- ${p.content}`).join('\n'),
        );
      }
      if (userList.length > 0) {
        segments.push(
          '# 关于用户：以下是对你交流对象的定义,请据此调整交流方式（术语层级、语气、举例风格等）\n' +
            '以下条目定义了"用户是谁"（身份、背景、偏好，已由用户审核通过）。你可以在需要时自然引用（"据我所知你是..."），并据此选择合适的术语、举例与表达：\n' +
            userList.map((p) => `- ${p.content}`).join('\n'),
        );
      }

      return {
        source: 'persona',
        message: {
          role: 'system',
          content: segments.join('\n\n'),
        },
      };
    },
  };
}
