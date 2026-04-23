/**
 * remember_persona · 主 LLM 显式记录"自己应长期遵守的指令"
 * ---------------------------------------------
 * v0.2.2 语义转向（重要）：
 *   过去版本把 Persona 当作"关于用户的稳定事实"（例如"用户是前端工程师"）。
 *   实践中我们发现：
 *   - 模型自发调用本 tool 时，内容往往是"我是 XX 助手"这类**自我设定**
 *   - 用户说"叫我小瑾"时，真正有价值的不是"用户叫小瑾"，而是 Agent 应当
 *     "称呼用户为小瑾"这条**可执行指令**
 *   因此从 v0.2.2 起 Persona 被重新定义为 **Agent 的长期操作指令 / 行为规则**，
 *   存的永远是一段让 Agent 知道"**我**应该怎么做"的陈述。
 *
 * 与反思 Job 的 persona_extraction 区别：
 * - 反思路径：辅 LLM 事后从对话中归纳 Agent 应如何服务用户，产出 status='pending' 候选。
 * - 本 tool：主 LLM 在对话中明确感知到"接下来起作用的规则"时调用，
 *   产出 status='confirmed'（reviewedByUser=true, source.extractedBy='user_explicit'），
 *   立即生效并注入后续的 PersonaSource。
 *
 * 依赖：MemoryStore.addPersonaCandidate。
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
      '记录一条你（Agent）**应当长期遵守的指令或行为规则**——这是跨会话、跨页面都生效的长期记忆。\n\n**与 WorkingMemory 的区别（非常重要，不要混）**：\n- WorkingMemory（set_active_goal / add_todo）= 当前这个页面 / 这轮任务的状态；换页面或任务结束就不再相关。\n- remember_persona = 影响你**以后所有对话**的规则。用户换到任何新页面都应继续遵守。\n\n**主动触发的时机**：\n- 用户表达了**稳定的偏好/背景**：例如"叫我小瑾"、"我是前端工程师"、"我喜欢结构化回答"、"以后 TS 就是 TypeScript"。\n- 用户**纠正了你的风格/用词**：例如"不要每次都加"建议"前缀"、"回答长一点没关系，但别跳步骤"。\n- 会话中自然形成的**身份/合作模式**：例如用户明确赋予你一个身份（"你是我的文档助手"），或确认了某个工作方式。\n\n**不要调用**：\n- 一次性的问题或请求（"这篇文章的作者是谁"）——那是本次对话的内容，不是长期规则。\n- 情绪化表达（"这段写得不错"）、对页面内容的评论。\n- 只在本次页面有效的约定（那属于 WorkingMemory）。\n\n**内容格式要求（关键）**：content 必须是**写给你自己看的祈使/陈述句**，直接表达"你应该怎么做"。如果用户讲的是**他自己的背景**，请先把它**转译为 Agent 的行为规则**再写入：\n- 用户说"我是前端" → 写"回答时默认使用前端语境举例，不必解释基础 Web 概念"（不要写"用户是前端工程师"）\n- 用户说"叫我小瑾" → 写"称呼用户为小瑾"\n- 用户说"我喜欢结构化回答" → 写"回答时使用结构化要点，而不是长段落叙述"\n- 用户说"以后 TS 就是 TypeScript" → 写"遇到 TS 默认理解为 TypeScript，不要反问"\n- 用户说"你是小瑾的文档助手" → 写"你的身份是小瑾的文档助手，专注陪伴阅读技术文档"',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            '一条写给 Agent 自己的长期指令（10-60 字，陈述/祈使句，不要用"用户说 ..."这种冗余叙述）',
          minLength: 2,
        },
        confidence: {
          type: 'number',
          description: '置信度 0-1，默认 0.9（用户或当下语境明确触达时应较高）',
          minimum: 0,
          maximum: 1,
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '可选关键词标签（例如 identity / style / term-alias）',
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
