/**
 * DexieDatabase · IndexedDB 表结构
 * ---------------------------------------------
 * v0.2 · 记忆层 IndexedDB 持久化的 schema 定义（Dexie v4）
 *
 * 表 / 索引设计原则：
 * - 主键用业务 id 字符串（非自增），便于跨表关联与幂等写入
 * - 索引只列"会出现在查询 where 的字段"，避免写入开销爆炸
 * - 向量字段 `embedding` 不加索引（余弦相似度走内存扫）
 *
 * 六张表：
 * 1. episodes_msg         消息级事件记忆（每条对话消息原文）
 * 2. episodes_visit_summary  visit 摘要（反思生成 + embedding，召回入口）
 * 3. persona              个性记忆（全局，Top-10 注入）
 * 4. session_topics       情景记忆（按 visitId）
 * 5. working_memories     工作记忆（按 canonicalUrl）
 * 6. reflection_tasks     反思任务队列
 * 7. page_visits          PageVisit 元数据（便于 SW 反思时查 visit 信息）
 */

import Dexie, { type Table } from 'dexie';
import type {
  MemoryRecord,
  PersonaRecord,
  SessionTopicRecord,
  WorkingMemoryRecord,
  ReflectionTask,
  PageVisitRecord,
} from '../interface';

export const DEFAULT_DB_NAME = 'doc-assistant-memory';
export const DB_VERSION = 1;

export class MemoryDatabase extends Dexie {
  episodes_msg!: Table<MemoryRecord, string>;
  episodes_visit_summary!: Table<MemoryRecord, string>;
  persona!: Table<PersonaRecord, string>;
  session_topics!: Table<SessionTopicRecord, string>;
  working_memories!: Table<WorkingMemoryRecord, string>;
  reflection_tasks!: Table<ReflectionTask, string>;
  page_visits!: Table<PageVisitRecord, string>;

  constructor(dbName: string = DEFAULT_DB_NAME) {
    super(dbName);
    this.version(DB_VERSION).stores({
      // 消息级 episodic：按 visitId + orderInVisit 区间查询邻居；按 timestamp 排序
      episodes_msg: 'id, visitId, canonicalUrl, domain, timestamp, [visitId+orderInVisit]',
      // visit 摘要：按 canonicalUrl / domain / timestamp 查询；embedding 不索引
      episodes_visit_summary: 'id, visitId, canonicalUrl, domain, timestamp',
      // Persona：按 status 过滤（pending/confirmed/rejected）
      persona: 'id, status, updatedAt',
      // SessionTopic：主键就是 visitId
      session_topics: 'visitId, canonicalUrl, updatedAt',
      // WorkingMemory：主键是 canonicalUrl；按 lastAccessedAt 做 LRU
      working_memories: 'canonicalUrl, visitId, articleId, lastAccessedAt',
      // ReflectionTask：按 status 过滤 pending；按 visitId 关联
      reflection_tasks: 'id, status, visitId, createdAt',
      // PageVisit：主键 visitId
      page_visits: 'visitId, canonicalUrl, domain, startedAt',
    });
  }
}

/** 便于测试的重置函数（单测用，切勿在生产调用） */
export async function resetMemoryDatabase(db: MemoryDatabase): Promise<void> {
  await Promise.all([
    db.episodes_msg.clear(),
    db.episodes_visit_summary.clear(),
    db.persona.clear(),
    db.session_topics.clear(),
    db.working_memories.clear(),
    db.reflection_tasks.clear(),
    db.page_visits.clear(),
  ]);
}
