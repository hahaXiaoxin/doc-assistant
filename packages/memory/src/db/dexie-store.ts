/**
 * DexieMemoryStore · MemoryStore 的 IndexedDB 实现
 * ---------------------------------------------
 * v0.2 · 四层记忆的主要载体
 *
 * 设计要点：
 * - 所有写入前走 shared.redactSensitive 做敏感过滤（由 MemorySettings 控制开关）
 * - remember() 根据 record.type 路由到对应表（episodes_msg / episodes_visit_summary / persona）
 * - recall() 走 `semantic` 向量（若提供 embedVec）或关键词 LIKE 兜底
 * - 所有可选方法（Persona/WorkingMemory/SessionTopic/ReflectionTask）都在此实现
 * - 构造时可注入 `getNow()`/`genId()` 以便测试打桩
 *
 * 线程安全：Dexie 本身串行化；本类无需额外锁。
 */

import { createLogger, redactSensitiveText } from '@doc-assistant/shared';
import type {
  MemoryRecord,
  MemoryStore,
  RecallQuery,
  PersonaRecord,
  PersonaStatus,
  SessionTopicRecord,
  WorkingMemoryRecord,
  ReflectionTask,
  ReflectionStatus,
  PageVisitRecord,
} from '../interface';
import { MemoryDatabase, DEFAULT_DB_NAME } from './schema';
import { cosineSim, topK } from './vector';

const logger = createLogger('memory:dexie');

export interface DexieMemoryStoreOptions {
  /** 自定义数据库名（测试隔离） */
  dbName?: string;
  /** 敏感过滤开关（默认 true） */
  sensitiveFilterEnabled?: boolean;
  /**
   * 召回时的 embedding 计算函数：对 semantic 字符串生成向量后在 episodes_visit_summary 里做余弦。
   * 若未注入，recall() 走关键词 LIKE 兜底（适用于没有 embedding provider 的环境）。
   */
  embedQuery?: (text: string) => Promise<Float32Array>;
  /** 测试打桩：时间源 */
  getNow?: () => number;
  /** 测试打桩：ID 生成 */
  genId?: () => string;
  /** 测试打桩：直接注入 Dexie 实例（fake-indexeddb 场景） */
  db?: MemoryDatabase;
}

/** 读路径防腐：合法的 MemoryRecord.type 集合，读到外的记录会被 skip + warn */
const VALID_RECORD_TYPES: ReadonlySet<MemoryRecord['type']> = new Set([
  'message',
  'persona',
  'visit_summary',
]);

export class DexieMemoryStore implements MemoryStore {
  private readonly db: MemoryDatabase;
  private readonly sensitiveFilterEnabled: boolean;
  private readonly embedQuery?: (text: string) => Promise<Float32Array>;
  private readonly getNow: () => number;
  private readonly genId: () => string;

  constructor(opts: DexieMemoryStoreOptions = {}) {
    this.db = opts.db ?? new MemoryDatabase(opts.dbName ?? DEFAULT_DB_NAME);
    this.sensitiveFilterEnabled = opts.sensitiveFilterEnabled ?? true;
    if (opts.embedQuery) this.embedQuery = opts.embedQuery;
    this.getNow = opts.getNow ?? (() => Date.now());
    this.genId =
      opts.genId ??
      ((): string => {
        // 兼容性：优先用 crypto.randomUUID，回退到 timestamp+random
        const g = globalThis as { crypto?: { randomUUID?: () => string } };
        if (g.crypto?.randomUUID) return g.crypto.randomUUID();
        return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      });
    logger.info('DexieMemoryStore 初始化', {
      dbName: opts.dbName ?? DEFAULT_DB_NAME,
      sensitiveFilter: this.sensitiveFilterEnabled,
      hasEmbedQuery: !!this.embedQuery,
    });
  }

  /* ---------------- MemoryStore.remember ---------------- */

  async remember(record: MemoryRecord): Promise<void> {
    // 敏感过滤仅对 content 做；embedding 不影响
    const safeContent = this.sensitiveFilterEnabled
      ? redactSensitiveText(record.content, true)
      : record.content;
    const row: MemoryRecord = { ...record, content: safeContent };

    // 根据 type 路由
    switch (record.type) {
      case 'visit_summary':
        await this.db.episodes_visit_summary.put(row);
        return;
      case 'persona':
        // remember(type='persona') 视为"用户显式 remember_persona tool 写入"，
        // 直接建为 confirmed Persona（含溯源需通过 addPersonaCandidate 更标准）
        await this.db.persona.put({
          id: row.id,
          content: row.content,
          status: 'confirmed',
          confidence: Number((row.meta?.confidence as number) ?? 1),
          hitCount: 1,
          reviewedByUser: true,
          createdAt: row.timestamp,
          updatedAt: row.timestamp,
          source: {
            visitId: row.visitId ?? '',
            messageIds: [],
            extractedBy: 'user_explicit',
          },
          ...(Array.isArray(row.meta?.tags) ? { tags: row.meta!.tags as string[] } : {}),
        });
        return;
      case 'message':
      default:
        await this.db.episodes_msg.put(row);
        return;
    }
  }

  /* ---------------- MemoryStore.recall ---------------- */

  async recall(query: RecallQuery): Promise<MemoryRecord[]> {
    const limit = query.limit ?? 10;
    const types = query.types ?? ['visit_summary'];

    // 聚合候选：对每个 type 取对应表，并应用过滤条件
    const candidates: MemoryRecord[] = [];
    let droppedDirty = 0;
    for (const t of types) {
      const table = this.pickTable(t);
      if (!table) continue;
      let coll = table.toCollection();

      // 应用简单过滤
      if (query.canonicalUrl) {
        coll = table.where('canonicalUrl').equals(query.canonicalUrl);
      } else if (query.domain) {
        coll = table.where('domain').equals(query.domain);
      } else if (query.articleId) {
        coll = coll.filter((r) => r.articleId === query.articleId);
      }

      const list = await coll.toArray();
      for (const r of list) {
        // schema 防腐：读到合法集合外的 type（例如遗留脏数据）直接跳过
        if (!VALID_RECORD_TYPES.has(r.type)) {
          droppedDirty += 1;
          continue;
        }
        // timeRange
        if (query.timeRange) {
          if (r.timestamp < query.timeRange[0] || r.timestamp > query.timeRange[1]) continue;
        }
        // topic
        if (query.topic) {
          if (!r.topic || !r.topic.includes(query.topic)) continue;
        }
        candidates.push(r as MemoryRecord);
      }
    }

    if (droppedDirty > 0) {
      logger.warn(`recall: 跳过 ${droppedDirty} 条非法 type 的脏记录（schema 防腐）`);
    }

    if (candidates.length === 0) return [];

    // 语义排序
    if (query.semantic) {
      if (this.embedQuery) {
        try {
          const vec = await this.embedQuery(query.semantic);
          const scored = topK(vec, candidates, (r) => r.embedding, limit);
          return scored.map((s) => s.item);
        } catch (err) {
          logger.warn('embedQuery 失败，降级到关键词匹配', (err as Error).message);
        }
      }
      // 关键词 LIKE 兜底
      const kw = query.semantic.toLowerCase();
      const ranked = candidates
        .map((r) => ({ r, score: scoreKeyword(r.content, kw) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);
      return ranked.slice(0, limit).map((x) => x.r);
    }

    // 无 semantic 时按 timestamp 倒序
    candidates.sort((a, b) => b.timestamp - a.timestamp);
    return candidates.slice(0, limit);
  }

  private pickTable(type: MemoryRecord['type']) {
    switch (type) {
      case 'visit_summary':
        return this.db.episodes_visit_summary;
      case 'persona':
        return null; // Persona 不走通用 recall（有专属 listPersonas）
      case 'message':
      default:
        return this.db.episodes_msg;
    }
  }

  /* ---------------- WorkingMemory ---------------- */

  async getWorkingMemory(canonicalUrl: string): Promise<WorkingMemoryRecord | null> {
    const row = await this.db.working_memories.get(canonicalUrl);
    return row ?? null;
  }

  async setWorkingMemory(record: WorkingMemoryRecord): Promise<void> {
    await this.db.working_memories.put({
      ...record,
      updatedAt: record.updatedAt || this.getNow(),
      lastAccessedAt: record.lastAccessedAt || this.getNow(),
    });
  }

  async touchWorkingMemory(canonicalUrl: string, at?: number): Promise<void> {
    const ts = at ?? this.getNow();
    const existing = await this.db.working_memories.get(canonicalUrl);
    if (!existing) return;
    await this.db.working_memories.put({
      ...existing,
      lastAccessedAt: ts,
    });
  }

  async archiveStaleWorkingMemories(ttlMs: number): Promise<number> {
    const threshold = this.getNow() - ttlMs;
    const stale = await this.db.working_memories
      .where('lastAccessedAt')
      .below(threshold)
      .and((r) => !r.archivedAt) // 未归档的
      .toArray();
    if (stale.length === 0) return 0;

    const now = this.getNow();
    for (const wm of stale) {
      await this.db.working_memories.put({ ...wm, archivedAt: now });
      // 归档时附带写一条 episodes_visit_summary 作为"未完成的计划"（无 embedding）
      if (wm.todos.some((t) => t.status !== 'done' && t.status !== 'skipped')) {
        const archiveRecord: MemoryRecord = {
          id: `archived-wm-${wm.canonicalUrl}-${now}`,
          type: 'visit_summary',
          content: buildArchiveSummary(wm),
          timestamp: now,
          canonicalUrl: wm.canonicalUrl,
          meta: { archivedWorkingMemory: true, activeGoal: wm.activeGoal },
        };
        if (wm.articleId !== undefined) archiveRecord.articleId = wm.articleId;
        if (wm.domain !== undefined) archiveRecord.domain = wm.domain;
        await this.db.episodes_visit_summary.put(archiveRecord);
      }
    }
    logger.info(`LRU 归档了 ${stale.length} 条 WorkingMemory (ttlMs=${ttlMs})`);
    return stale.length;
  }

  /* ---------------- Persona ---------------- */

  async listPersonas(opts?: { status?: PersonaStatus }): Promise<PersonaRecord[]> {
    if (opts?.status) {
      return this.db.persona.where('status').equals(opts.status).toArray();
    }
    return this.db.persona.toArray();
  }

  async addPersonaCandidate(
    candidate: Omit<PersonaRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PersonaRecord> {
    const now = this.getNow();
    const record: PersonaRecord = {
      id: this.genId(),
      createdAt: now,
      updatedAt: now,
      ...candidate,
    };
    await this.db.persona.put(record);
    return record;
  }

  async updatePersona(
    id: string,
    patch: Partial<PersonaRecord>,
    reason?: string,
  ): Promise<void> {
    const existing = await this.db.persona.get(id);
    if (!existing) return;
    const now = this.getNow();
    const history = [...(existing.history ?? [])];
    if (patch.content && patch.content !== existing.content) {
      history.push({ at: now, oldContent: existing.content, newContent: patch.content, reason: reason ?? 'update' });
    } else if (reason) {
      history.push({ at: now, reason });
    }
    await this.db.persona.put({
      ...existing,
      ...patch,
      updatedAt: now,
      history,
    });
  }

  /* ---------------- SessionTopic ---------------- */

  async setSessionTopic(record: SessionTopicRecord): Promise<void> {
    await this.db.session_topics.put({
      ...record,
      updatedAt: record.updatedAt || this.getNow(),
    });
  }

  async getSessionTopic(visitId: string): Promise<SessionTopicRecord | null> {
    const row = await this.db.session_topics.get(visitId);
    return row ?? null;
  }

  /* ---------------- ReflectionTask ---------------- */

  async enqueueReflection(
    task: Omit<ReflectionTask, 'id' | 'createdAt' | 'attemptsCount' | 'status'> & {
      id?: string;
      status?: ReflectionStatus;
    },
  ): Promise<ReflectionTask> {
    const now = this.getNow();
    const record: ReflectionTask = {
      id: task.id ?? this.genId(),
      visitId: task.visitId,
      taskType: task.taskType,
      status: task.status ?? 'pending',
      attemptsCount: 0,
      createdAt: now,
      ...(task.completedAt !== undefined ? { completedAt: task.completedAt } : {}),
      ...(task.lastError !== undefined ? { lastError: task.lastError } : {}),
    };
    await this.db.reflection_tasks.put(record);
    return record;
  }

  async listPendingReflections(maxAttempts: number = 3): Promise<ReflectionTask[]> {
    const pending = await this.db.reflection_tasks.where('status').equals('pending').toArray();
    return pending.filter((t) => t.attemptsCount < maxAttempts);
  }

  async updateReflection(
    id: string,
    patch: Partial<Pick<ReflectionTask, 'status' | 'attemptsCount' | 'completedAt' | 'lastError'>>,
  ): Promise<void> {
    const existing = await this.db.reflection_tasks.get(id);
    if (!existing) return;
    await this.db.reflection_tasks.put({ ...existing, ...patch });
  }

  /* ---------------- PageVisit ---------------- */

  async recordPageVisit(visit: PageVisitRecord): Promise<void> {
    await this.db.page_visits.put(visit);
  }

  /* ---------------- lifecycle ---------------- */

  async close(): Promise<void> {
    this.db.close();
  }

  /** 暴露底层 db 实例，主要用于测试。 */
  _unsafeGetDb(): MemoryDatabase {
    return this.db;
  }
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                            */
/* ------------------------------------------------------------------ */

function scoreKeyword(content: string, keyword: string): number {
  const lower = content.toLowerCase();
  if (!lower.includes(keyword)) return 0;
  // 粗略打分：命中次数 + 短内容加权
  const count = lower.split(keyword).length - 1;
  return count + 10 / Math.max(content.length, 1);
}

function buildArchiveSummary(wm: WorkingMemoryRecord): string {
  const pending = wm.todos.filter((t) => t.status !== 'done' && t.status !== 'skipped');
  const lines = [
    `[归档自 WorkingMemory]`,
    wm.activeGoal ? `目标：${wm.activeGoal}` : '',
    '未完成事项：',
    ...pending.map((t, i) => `  ${i + 1}. ${t.content}`),
  ].filter(Boolean);
  return lines.join('\n');
}

/** 计算两向量相似度的便捷导出（方便测试/调试） */
export { cosineSim };
