/**
 * remember_persona · 主 LLM 显式记录"一条 Persona 定义"
 * ---------------------------------------------
 * v0.4.0 语义（Persona 双主体）：
 *   每条 Persona 都在回答"**这是在定义谁**"：
 *   - subject='agent' · 在定义 **agent 是谁**：身份、角色、性格、能力边界、行为方式、术语/风格约定
 *   - subject='user'  · 在定义 **user 是谁**：身份、背景、偏好（保持原貌，不要再转译成 agent 指令）
 *
 *   两类协同工作：agent 侧的定义让 agent 知道"我是谁、我怎么说话"；user 侧
 *   的定义让 agent 据此调整表达（术语层级、语气、举例风格）。同一句用户发言
 *   可以同时产出两条 candidate（见下面 description 的示例）。
 *
 * 与反思 Job 的 persona_extraction 区别：
 * - 反思路径：辅 LLM 事后归纳 agent/user 两类定义，产出 status='pending' 候选。
 * - 本 tool：主 LLM 在对话中明确感知到"这是一条值得固化的定义"时调用，
 *   产出 status='confirmed'（reviewedByUser=true, source.extractedBy='user_explicit'），
 *   立即生效并注入后续的 PersonaSource。
 *
 * 依赖：MemoryStore.addPersonaCandidate。
 */
import type { ToolDefinition } from '@doc-assistant/shared';
import type {
  MemoryStore,
  PersonaRecord,
  PersonaSubject,
} from '@doc-assistant/memory';

export interface RememberPersonaToolDeps {
  memory: MemoryStore;
  getCurrentVisitId?: () => string | undefined;
  getNow?: () => number;
  genId?: () => string;
}

interface RememberPersonaArgs {
  content: string;
  subject: PersonaSubject;
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
      '记录一条长期记忆条目——一条 **Persona 定义**，跨会话、跨页面都生效。每条 Persona 都在回答"**这是在定义谁**"（subject）：\n\n- `subject="agent"` → 在定义 **agent 是谁**：身份、角色、名字、性格、能力边界、行为方式、表达风格与术语约定。例：\n  * "你叫小瑾，是我的文档阅读助手" → agent（定义身份）\n  * "你回答要简洁，少讲废话" → agent（定义行为方式）\n  * "遇到代码先讲结论再贴示例" → agent（定义表达风格）\n- `subject="user"` → 在定义 **user 是谁**：身份、背景、偏好（保持原貌，**不要**转译成 agent 指令）。例：\n  * "我是前端工程师" → user（定义用户身份）\n  * "我偏好 Vue 生态" → user（定义用户偏好）\n  * "我的母语是中文" → user（定义用户背景）\n\n**两类可同时产出**：用户说"我是前端" → 可以写两条 candidate：\n  1. subject="user"  · "用户是前端工程师"\n  2. subject="agent" · "回答时默认用前端语境举例，不必解释基础 Web 概念"\n请自行判断两条是否都值得写。\n\n**关键消歧义**（第二人称"你"一律指 agent）：\n  用户说"你的名字叫小瑾" → **一条** candidate：\n    subject="agent" · "你叫小瑾，当用户直接用小瑾称呼时，要明白是在叫自己"——这是在定义 agent 的身份，不是用户自称叫小瑾。\n\n**与 WorkingMemory 的区别（非常重要，不要混）**：\n- WorkingMemory（set_active_goal / add_todo）= 当前这个页面 / 这轮任务的状态；换页面或任务结束就不再相关。\n- remember_persona = 跨会话、跨页面的**定义**。用户换到任何新页面都继续生效。\n\n**不要调用**：\n- 一次性的问题或请求（"这篇文章的作者是谁"）——那是本次对话的内容，不是长期定义。\n- 情绪化表达（"这段写得不错"）、对页面内容的评论。\n- 只在本次页面有效的事务（那属于 WorkingMemory）。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            '这条 Persona 的具体定义内容（10-60 字，陈述/祈使句）。subject="agent" 时写给 agent 自己看（例："你叫小瑾"）；subject="user" 时保持对用户的原貌陈述（例："用户是前端工程师"）。',
          minLength: 2,
        },
        subject: {
          type: 'string',
          enum: ['agent', 'user'],
          description:
            '这条信息在**定义谁**：\n- "agent"：在定义 agent 是谁（身份、角色、性格、能力边界、行为方式）\n- "user"：在定义 user 是谁（身份、背景、偏好）\n判断标准只看"这条信息在定义谁"，不要被第二人称/第一人称句式误导。',
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
      required: ['content', 'subject'],
      additionalProperties: false,
    },
    async execute(args) {
      const content = (args.content ?? '').trim();
      if (!content) return { ok: false, error: 'content 不能为空' };
      if (args.subject !== 'agent' && args.subject !== 'user') {
        return {
          ok: false,
          error: "subject 必须为 'agent' 或 'user'",
        };
      }
      try {
        const visitId = deps.getCurrentVisitId?.() ?? '';
        const confidence = Math.max(0, Math.min(1, args.confidence ?? 0.9));
        const payload: Omit<PersonaRecord, 'id' | 'createdAt' | 'updatedAt'> = {
          subject: args.subject,
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
