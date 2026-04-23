/**
 * remember_persona · 主 LLM 显式记录用户的"稳定偏好/事实"
 * ---------------------------------------------
 * v0.2.1 · 与反思 Job 的 persona_extraction 区别：
 * - 反思路径：辅 LLM 事后抽取；产出 status='pending' 候选，等待用户审核。
 * - 本 tool：主 LLM 在对话中检测到用户**显式**声明（如"记住我..." / "以后请注意我..."），
 *   产出 status='confirmed'（`reviewedByUser=true`，但标注 source.extractedBy='user_explicit'），
 *   立即注入后续的 PersonaSource。
 *
 * 依赖：MemoryStore.addPersonaCandidate / remember。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type { MemoryStore, PersonaRecord } from '@doc-assistant/memory';

export interface RememberPersonaToolDeps {
  memory: MemoryStore;
  getCurrentVisitId?: () => string | undefined;
  getNow?: () => number;
  genId?: () => string;
}

interface RememberPersonaArgs {
  content: string;
  confidence?: number;
  tags?: string[];
}

type RememberPersonaResult =
  | { ok: true; persona: PersonaRecord }
  | { ok: false; error: string };

export function createRememberPersonaTool(
  deps: RememberPersonaToolDeps,
): ToolDefinition<RememberPersonaArgs, RememberPersonaResult> {
  return {
    name: 'remember_persona',
    description:
      '当用户**明确**要求你记住某件关于他/她自己的稳定事实或偏好时调用（比如"以后我说 TS 就是 TypeScript"、"我是前端工程师"、"我喜欢结构化回答"）。content 必须是陈述句；对一次性问题、情绪表达不要调用此 tool。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '关于用户的稳定陈述（一句话，10-60 字）',
          minLength: 2,
        },
        confidence: {
          type: 'number',
          description: '置信度 0-1，默认 0.9（用户显式声明本应较高）',
          minimum: 0,
          maximum: 1,
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '可选关键词标签',
        },
      },
      required: ['content'],
      additionalProperties: false,
    },
    async execute(args) {
      const content = (args.content ?? '').trim();
      if (!content) return { ok: false, error: 'content 不能为空' };
      if (!deps.memory.addPersonaCandidate) {
        return { ok: false, error: 'MemoryStore 不支持 Persona API' };
      }
      try {
        const visitId = deps.getCurrentVisitId?.() ?? '';
        const confidence = Math.max(0, Math.min(1, args.confidence ?? 0.9));
        const payload: Omit<PersonaRecord, 'id' | 'createdAt' | 'updatedAt'> = {
          content,
          status: 'confirmed', // 用户显式声明视为已确认
          confidence,
          hitCount: 1,
          reviewedByUser: true, // 显式声明即视为已审核
          source: {
            ...(visitId ? { visitId } : {}),
            extractedBy: 'user_explicit',
            messageIds: [],
          },
          ...(args.tags && args.tags.length > 0
            ? { tags: args.tags.filter((t) => typeof t === 'string' && t.trim().length > 0) }
            : {}),
        };
        const persona = await deps.memory.addPersonaCandidate(payload);
        return { ok: true, persona };
      } catch (err) {
        return { ok: false, error: `remember_persona 失败：${(err as Error).message}` };
      }
    },
  };
}
