/**
 * ReflectionRunner · 反思任务的具体执行器
 * ---------------------------------------------
 * v0.2.1 · 在 PageVisit 结束后异步补跑的"慢思考"任务。
 *
 * 支持三种任务类型（对应 ReflectionTaskType）：
 * - `visit_summary`：根据该 visit 的所有 episodes_msg 生成一段 200 字内摘要 + embedding，
 *   落 `episodes_visit_summary` 表，供后续 RelevantMemorySource 向量召回使用。
 * - `persona_extraction`：v0.2.2 语义升级。不再抽取"关于用户的事实"，改为归纳
 *   **Agent 应如何长期服务用户的指令 / 行为规则**（祈使/陈述句，写给 Agent 自己看），
 *   登记为 `pending` 状态的 PersonaRecord，等用户在 sidebar banner / 配置页审核。
 * - `persona_conflict_check`：（本期骨架，仅作 no-op 占位返回 ok）
 *
 * 设计原则：
 * - 单个任务失败**不**影响其它任务；失败时返回结构化结果由 Scheduler 写回 `reflection_tasks`。
 * - 所有对 aux/embedding 的调用都有超时 + 失败降级，不让反思 Job 卡死 SW/sidebar。
 * - Persona 抽取的 JSON 解析宽松（与 aux/session-topic 同构）。
 */
import type { LLMProvider } from '@doc-assistant/provider';
import type { EmbeddingProvider } from '@doc-assistant/provider';
import type {
  MemoryRecord,
  MemoryStore,
  PersonaRecord,
  PersonaSubject,
  ReflectionTask,
  ReflectionTaskType,
} from '@doc-assistant/memory';
import type { ChatMessage } from '@doc-assistant/shared';
import { createLogger } from '@doc-assistant/shared';
import { collectText } from '../aux/collect-text';

const logger = createLogger('agent:reflection:runner');

export interface ReflectionRunnerDeps {
  memory: MemoryStore;
  aux: LLMProvider;
  /** 可选：有则 visit_summary 会带 embedding 以供向量召回 */
  embedding?: EmbeddingProvider | null;
  getNow?: () => number;
  genId?: () => string;
}

export type ReflectionRunOutcome =
  | { ok: true; taskType: ReflectionTaskType; detail?: Record<string, unknown> }
  | { ok: false; taskType: ReflectionTaskType; error: string };

export class ReflectionRunner {
  private readonly deps: Required<
    Omit<ReflectionRunnerDeps, 'embedding'>
  > & { embedding: EmbeddingProvider | null };

  constructor(deps: ReflectionRunnerDeps) {
    this.deps = {
      memory: deps.memory,
      aux: deps.aux,
      embedding: deps.embedding ?? null,
      getNow: deps.getNow ?? ((): number => Date.now()),
      genId: deps.genId ?? defaultGenId,
    };
  }

  /** 按 taskType 分发 */
  async run(task: ReflectionTask): Promise<ReflectionRunOutcome> {
    // v0.6.0 埋点:记录耗时 + 结果
    const started = this.deps.getNow();
    const finish = (outcome: ReflectionRunOutcome): ReflectionRunOutcome => {
      const elapsed = this.deps.getNow() - started;
      if (outcome.ok) {
        logger.info('reflection ok', {
          taskType: outcome.taskType,
          visitId: task.visitId,
          elapsedMs: elapsed,
          ...(outcome.detail ?? {}),
        });
      } else {
        logger.error('reflection failed', {
          taskType: outcome.taskType,
          visitId: task.visitId,
          elapsedMs: elapsed,
          error: outcome.error,
        });
      }
      return outcome;
    };

    switch (task.taskType) {
      case 'visit_summary':
        return finish(await this.runVisitSummary(task));
      case 'persona_extraction':
        return finish(await this.runPersonaExtraction(task));
      case 'persona_conflict_check':
        return finish(await this.runPersonaConflictCheck(task));
      default:
        return finish({
          ok: false,
          taskType: task.taskType,
          error: `unknown taskType: ${task.taskType}`,
        });
    }
  }

  /* ------------------------------------------------------------- */
  /* visit_summary                                                  */
  /* ------------------------------------------------------------- */

  private async runVisitSummary(task: ReflectionTask): Promise<ReflectionRunOutcome> {
    const { memory, aux, embedding, getNow, genId } = this.deps;
    try {
      // 拉取该 visit 的原始消息（走 recall，不依赖专属方法）
      const episodes = await memory.recall({
        types: ['message'],
        limit: 200,
      });
      const visitEpisodes = episodes
        .filter((e) => e.visitId === task.visitId)
        .sort((a, b) => (a.orderInVisit ?? 0) - (b.orderInVisit ?? 0));

      if (visitEpisodes.length === 0) {
        return {
          ok: true,
          taskType: 'visit_summary',
          detail: { skipped: true, reason: 'no episodes found' },
        };
      }

      // 压缩成 aux 输入
      const condensed = visitEpisodes
        .map((e) => `${e.role ?? 'user'}: ${(e.content ?? '').slice(0, 300)}`)
        .join('\n')
        .slice(0, 6_000); // 粗略上限

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `你是一个对话记录总结助手。阅读下面一次 PageVisit 的对话，用不超过 200 字中文生成一段摘要（客观陈述，不要"用户说..."这种冗余套话），以及 3-6 个关键词标签。
严格按以下 JSON 输出：
{"summary": "...", "tags": ["..."]}`,
        },
        { role: 'user', content: `对话记录：\n${condensed}` },
      ];

      const raw = await collectText(aux.chat({ messages, temperature: 0.3 }), {
        label: `visit-summary:${task.visitId}`,
        maxChars: 800,
      });
      const parsed = parseSummaryOutput(raw);
      if (!parsed || !parsed.summary) {
        return {
          ok: false,
          taskType: 'visit_summary',
          error: 'aux 返回的摘要为空',
        };
      }

      // 计算 embedding（可选；失败则落库不带 embedding，关键词兜底仍可用）
      let vec: Float32Array | undefined;
      if (embedding) {
        try {
          const out = await embedding.embed([parsed.summary]);
          vec = out[0];
        } catch (err) {
          logger.warn('embedding 失败（摘要仍落库，无向量）', (err as Error).message);
        }
      }

      const first = visitEpisodes[0]!;
      const now = getNow();

      // 取 page_visits.title 写入 meta.title，供 list_recent_visits 时间维清单显示。
      // 查询失败或无记录都静默降级（meta.title 不写，消费方走 URL 兜底）。
      let pageVisitTitle: string | undefined;
      try {
        const pv = await memory.getPageVisit(task.visitId);
        if (pv && typeof pv.title === 'string' && pv.title.trim().length > 0) {
          pageVisitTitle = pv.title;
        }
      } catch (err) {
        logger.warn('getPageVisit 失败（title 留空，消费方走 URL 兜底）', (err as Error).message);
      }

      const record: MemoryRecord = {
        id: genId(),
        type: 'visit_summary',
        content: parsed.summary,
        timestamp: now,
        visitId: task.visitId,
        ...(vec ? { embedding: vec } : {}),
        ...(first.canonicalUrl !== undefined ? { canonicalUrl: first.canonicalUrl } : {}),
        ...(first.domain !== undefined ? { domain: first.domain } : {}),
        ...(first.articleId !== undefined ? { articleId: first.articleId } : {}),
        topic: parsed.tags,
        meta: {
          source: 'reflection',
          messageCount: visitEpisodes.length,
          ...(pageVisitTitle !== undefined ? { title: pageVisitTitle } : {}),
        },
      };
      await memory.remember(record);
      return {
        ok: true,
        taskType: 'visit_summary',
        detail: { summaryLength: parsed.summary.length, hasEmbedding: !!vec },
      };
    } catch (err) {
      return {
        ok: false,
        taskType: 'visit_summary',
        error: (err as Error).message,
      };
    }
  }

  /* ------------------------------------------------------------- */
  /* persona_extraction                                             */
  /* ------------------------------------------------------------- */

  private async runPersonaExtraction(task: ReflectionTask): Promise<ReflectionRunOutcome> {
    const { memory, aux, getNow } = this.deps;

    try {
      const episodes = await memory.recall({ types: ['message'], limit: 200 });
      const userMsgs = episodes
        .filter((e) => e.visitId === task.visitId && e.role === 'user')
        .map((e) => e.content ?? '')
        .filter(Boolean);

      if (userMsgs.length === 0) {
        return {
          ok: true,
          taskType: 'persona_extraction',
          detail: { skipped: true, reason: 'no user messages' },
        };
      }

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `你在为一个名为 Doc Assistant 的阅读助手整理**Persona 定义**——每条 Persona 都在回答"**这是在定义谁**"（subject）：
- subject="agent"：在定义 **agent 是谁**（身份、角色、性格、能力边界、行为方式、表达风格与术语约定）。
  * 用户说"你叫小瑾" → {"subject":"agent","content":"你叫小瑾，是用户的文档阅读助手"}
  * 用户说"你回答要简洁" → {"subject":"agent","content":"回答时保持简洁，不加多余的客套与前缀"}
  * 用户说"遇到代码先讲结论" → {"subject":"agent","content":"遇到代码示例时，先用一句话讲结论，再贴代码"}
- subject="user"：在定义 **user 是谁**（身份、背景、偏好）。**保持对用户的原貌陈述**，不要转译成 agent 指令。
  * 用户说"我是前端工程师" → {"subject":"user","content":"用户是前端工程师"}
  * 用户说"我偏好 Vue" → {"subject":"user","content":"用户偏好 Vue 生态"}
  * 用户说"我母语是中文" → {"subject":"user","content":"用户母语是中文"}

产出约束（非常重要）：
- 同一批对话可以同时产出 agent / user 两类 candidate，请分别列出。
  例：用户说"我是前端" → 可同时产出两条：
    1. {"subject":"user","content":"用户是前端工程师"}
    2. {"subject":"agent","content":"回答时默认用前端语境举例，不必解释基础 Web 概念"}
  是否两条都出由你判断，但 subject 字段必须是 'agent' 或 'user'，判断标准只看"**这条信息在定义谁**"。
- 消歧义：第二人称"你"一律指 agent。用户说"你叫 xxx" → subject="agent"，**不是**用户自称叫 xxx。
- 忽略一次性的提问、情绪化表达、只在本次页面有效的事务（那是 working memory 的事）。
- 每条候选独立可执行、10-60 字、不要堆砌。

严格按 JSON 输出（candidates 可为空数组）：
{"candidates": [{"subject": "agent" | "user", "content": "...", "confidence": 0-1, "tags": ["..."]}]}`,
        },
        { role: 'user', content: `用户消息：\n${userMsgs.map((m) => `- ${m.slice(0, 300)}`).join('\n')}` },
      ];

      const raw = await collectText(aux.chat({ messages, temperature: 0.2 }), {
        label: `persona-extract:${task.visitId}`,
        maxChars: 2_000,
      });
      const parsed = parsePersonaOutput(raw);
      if (!parsed || parsed.length === 0) {
        return {
          ok: true,
          taskType: 'persona_extraction',
          detail: { candidates: 0 },
        };
      }

      const existing = await memory.listPersonas();
      let added = 0;
      for (const cand of parsed) {
        const content = cand.content.trim();
        if (!content) continue;

        // dedupe：按 (content, subject) 组合键——同 content 但不同 subject 视为不同条
        const dup = existing.find(
          (p) => p.content.trim() === content && p.subject === cand.subject,
        );
        if (dup) {
          await memory.updatePersona(
            dup.id,
            { hitCount: dup.hitCount + 1, confidence: Math.max(dup.confidence, cand.confidence) },
            'reflection hit',
          );
          continue;
        }

        const candidatePayload: Omit<PersonaRecord, 'id' | 'createdAt' | 'updatedAt'> = {
          subject: cand.subject,
          content,
          status: 'pending',
          confidence: Math.max(0, Math.min(1, cand.confidence)),
          hitCount: 1,
          reviewedByUser: false,
          source: {
            visitId: task.visitId,
            extractedBy: 'reflection',
            messageIds: [],
          },
          ...(cand.tags && cand.tags.length ? { tags: cand.tags } : {}),
        };
        await memory.addPersonaCandidate(candidatePayload);
        added += 1;
      }

      return {
        ok: true,
        taskType: 'persona_extraction',
        detail: { parsed: parsed.length, added, now: getNow() },
      };
    } catch (err) {
      return {
        ok: false,
        taskType: 'persona_extraction',
        error: (err as Error).message,
      };
    }
  }

  /* ------------------------------------------------------------- */
  /* persona_conflict_check（占位，v0.2.2+ 实装）                    */
  /* ------------------------------------------------------------- */

  private async runPersonaConflictCheck(
    _task: ReflectionTask,
  ): Promise<ReflectionRunOutcome> {
    return {
      ok: true,
      taskType: 'persona_conflict_check',
      detail: { skipped: true, reason: 'not implemented in v0.2.1' },
    };
  }
}

/* ------------------------------------------------------------------ */
/* 解析辅助                                                            */
/* ------------------------------------------------------------------ */

interface ParsedSummary {
  summary: string;
  tags: string[];
}

export function parseSummaryOutput(raw: string): ParsedSummary | null {
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    const jsonSlice = raw.slice(braceStart, braceEnd + 1);
    try {
      const obj = JSON.parse(jsonSlice) as Record<string, unknown>;
      const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
      const tags = Array.isArray(obj.tags)
        ? obj.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : [];
      // JSON 解析成功——无论 summary 是否为空都尊重其结果，不再走行扫描
      return summary ? { summary, tags } : null;
    } catch {
      /* fallthrough to line-scan */
    }
  }
  // 行扫描回退：仅在没有合法 JSON 时触发
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 0 && lines[0]) {
    return { summary: lines[0].slice(0, 400), tags: [] };
  }
  return null;
}

export interface ParsedPersonaCandidate {
  subject: PersonaSubject;
  content: string;
  confidence: number;
  tags?: string[];
}

export function parsePersonaOutput(raw: string): ParsedPersonaCandidate[] {
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart < 0 || braceEnd < braceStart) return [];
  try {
    const obj = JSON.parse(raw.slice(braceStart, braceEnd + 1)) as {
      candidates?: Array<{
        subject?: unknown;
        content?: unknown;
        confidence?: unknown;
        tags?: unknown;
      }>;
    };
    const list = obj.candidates ?? [];
    return list
      .map((c): ParsedPersonaCandidate | null => {
        const content = typeof c.content === 'string' ? c.content : '';
        const subject =
          c.subject === 'agent' || c.subject === 'user' ? c.subject : null;
        if (!subject) return null;
        const confRaw = typeof c.confidence === 'number' ? c.confidence : 0.5;
        const tags = Array.isArray(c.tags)
          ? c.tags.filter((t): t is string => typeof t === 'string')
          : undefined;
        const base: ParsedPersonaCandidate = {
          subject,
          content,
          confidence: Math.max(0, Math.min(1, confRaw)),
        };
        if (tags) base.tags = tags;
        return base;
      })
      .filter((c): c is ParsedPersonaCandidate => c !== null && c.content.trim().length > 0);
  } catch {
    return [];
  }
}

function defaultGenId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
