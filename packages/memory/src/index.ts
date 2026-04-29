/**
 * @doc-assistant/memory · 入口
 * ---------------------------------------------
 * 职责：长期记忆存储与召回（四层记忆：Persona / Episodic / SessionTopic / WorkingMemory）。
 *
 * v0.2 更新（docs/ROADMAP.md §2 定稿方案）：
 * - Dexie IndexedDB 落地（DexieMemoryStore）
 * - 新增 Persona / WorkingMemory / SessionTopic / ReflectionTask 专属 API（全部作为可选方法）
 * - MemoryStore 契约不变，新增方法一律可选，NullMemoryStore 提供 no-op 兜底
 */

export type {
  MemoryRecord,
  MemoryRecordType,
  MemoryStore,
  RecallQuery,
  PersonaRecord,
  PersonaStatus,
  PersonaSubject,
  PersonaSource,
  WorkingMemoryRecord,
  TodoItem,
  TodoStatus,
  SessionTopicRecord,
  TopicStage,
  ReflectionTask,
  ReflectionStatus,
  ReflectionTaskType,
  PageVisitRecord,
} from './interface';

export { NullMemoryStore } from './null-store';

// v0.2 新增：Dexie 实现
export { DexieMemoryStore, type DexieMemoryStoreOptions } from './db/dexie-store';
export { MemoryDatabase, DEFAULT_DB_NAME, DB_VERSION, resetMemoryDatabase } from './db/schema';
export { cosineSim, norm, topK, type ScoredItem } from './db/vector';
