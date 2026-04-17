/**
 * MemoryStore 接口
 * ---------------------------------------------
 * 职责：长期记忆的写入与召回。
 *
 * MVP 范围：接口定义 + NullMemoryStore 空实现；所有方法是 no-op。
 * PHASE2: DexieMemoryStore 落地：
 *   - IndexedDB 持久化（Dexie）
 *   - 千问 embedding 向量化
 *   - recall() 支持语义查询（向量余弦） + 时间/域名/话题过滤
 *   - recall_memory tool 暴露给 Agent
 *   详见 docs/ROADMAP.md §2
 */

export type MemoryRecordType = 'message' | 'summary' | 'fact' | 'reference';

export interface MemoryRecord {
  id: string;
  type: MemoryRecordType;
  content: string;
  /** 向量（PHASE2 引入，MVP 为空） */
  embedding?: Float32Array;
  /** 时间戳（毫秒） */
  timestamp: number;

  // 索引维度
  articleId?: string;
  domain?: string;
  url?: string;
  topic?: string[];
  sessionId?: string;

  // 关系
  parentId?: string;
  references?: string[];

  // 其它
  meta?: Record<string, unknown>;
}

export interface RecallQuery {
  /** 语义查询（PHASE2 走向量；MVP 走关键词） */
  semantic?: string;
  timeRange?: [number, number];
  domain?: string;
  articleId?: string;
  topic?: string;
  limit?: number;
}

export interface MemoryStore {
  remember(record: MemoryRecord): Promise<void>;
  recall(query: RecallQuery): Promise<MemoryRecord[]>;
}
