/**
 * MemoryStore 接口
 * ---------------------------------------------
 * 职责：长期/工作/情景/个性 四层记忆的写入与召回。
 *
 * v0.1 MVP：接口定义 + NullMemoryStore 空实现；所有方法是 no-op。
 * v0.2 Phase2：DexieMemoryStore 落地（详见 docs/ROADMAP.md §2 与 test-prompt.md 定稿）
 *   - IndexedDB 持久化（Dexie）
 *   - 千问 embedding 向量化
 *   - recall() 支持语义查询（向量余弦） + 时间/域名/话题过滤
 *   - Persona / WorkingMemory / SessionTopic / ReflectionTask 专属 API（全部作为可选方法，
 *     NullMemoryStore 提供 no-op 兜底，保证 Agent 层对新方法的使用零 breaking）
 *
 * 契约稳定性承诺：
 * - `remember()` / `recall()` 签名不得修改（只能新增可选参数）
 * - 新增方法一律以 `?` 形式加入 MemoryStore
 * - MemoryRecord.type 联合可扩展；新类型与旧并存（v0.1 的 'message'/'fact' 等保留用于兼容）
 */

/* ------------------------------------------------------------------ */
/* 核心 MemoryRecord                                                    */
/* ------------------------------------------------------------------ */

/**
 * 记忆条目类型。
 * v0.1: 'message' | 'summary' | 'fact' | 'reference'
 * v0.2 新增：'persona' | 'visit_summary'（实际主要存储类型）
 */
export type MemoryRecordType =
  | 'message'
  | 'summary'
  | 'fact'
  | 'reference'
  | 'persona'
  | 'visit_summary';

export interface MemoryRecord {
  id: string;
  type: MemoryRecordType;
  content: string;
  /** 向量（v0.2 visit_summary 写入，其它类型按需） */
  embedding?: Float32Array;
  /** 时间戳（毫秒） */
  timestamp: number;

  // 索引维度（通用）
  articleId?: string;
  domain?: string;
  url?: string;
  topic?: string[];
  /** v0.1 兼容字段，新代码请用 visitId */
  sessionId?: string;

  // v0.2 新增索引维度
  /** PageVisit ID，一次 tab 开→关为一次 visit */
  visitId?: string;
  /** visit 内单调递增序号，便于按 orderInVisit 区间查询邻居消息 */
  orderInVisit?: number;
  /** 归一化后的 canonical URL（见 shared.canonicalizeUrl） */
  canonicalUrl?: string;
  /** 消息记录的 role，仅 type='message' 时有意义 */
  role?: 'user' | 'assistant' | 'tool';

  // 关系
  parentId?: string;
  references?: string[];

  // 其它元数据（Persona 的溯源/审核状态、visit_summary 的 tags、敏感过滤统计等）
  meta?: Record<string, unknown>;
}

export interface RecallQuery {
  /** 语义查询（v0.2 走向量余弦；NullStore 仍走关键词 LIKE） */
  semantic?: string;
  timeRange?: [number, number];
  domain?: string;
  articleId?: string;
  canonicalUrl?: string;
  topic?: string;
  /** 限定类型集合（默认召回 visit_summary） */
  types?: MemoryRecordType[];
  limit?: number;
}

/* ------------------------------------------------------------------ */
/* Persona 专属类型（候选/确认机制）                                    */
/* ------------------------------------------------------------------ */

/** Persona 的审核状态 */
export type PersonaStatus = 'pending' | 'confirmed' | 'rejected';

export interface PersonaSource {
  /** 哪次 visit / session 推出的 */
  visitId?: string;
  sessionId?: string;
  /** 信号来源的消息 id 列表 */
  messageIds?: string[];
  /** 抽取方式：反思归纳 | 用户显式声明 */
  extractedBy: 'reflection' | 'user_explicit';
}

export interface PersonaRecord {
  id: string;
  /**
   * 简短的陈述/祈使句（写给 Agent 看的长期指令）。
   * v0.2.2 语义转向：内容从"关于用户的事实"改为"Agent 应如何长期服务用户的规则"。
   * 例如："称呼用户为小瑾"、"回答时使用结构化要点"、"默认把 TS 理解为 TypeScript 不要反问"。
   */
  content: string;
  status: PersonaStatus;
  /** 置信度 0~1 */
  confidence: number;
  /** 反思命中次数（用于自动 confirmed 规则） */
  hitCount: number;
  /** 用户是否已审核；仅当 true 时允许自动注入 prompt */
  reviewedByUser: boolean;
  /** 首次发现时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 审核/更新历史 */
  history?: Array<{
    at: number;
    oldContent?: string;
    newContent?: string;
    reason: string;
  }>;
  /** 溯源信息 */
  source: PersonaSource;
  /** 可选：用于 dedupe/冲突检测的关键词标签 */
  tags?: string[];
}

/* ------------------------------------------------------------------ */
/* WorkingMemory 专属类型（按 canonicalUrl 绑定的 TODO）                */
/* ------------------------------------------------------------------ */

export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'skipped';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority?: 'high' | 'normal' | 'low';
  createdAt: number;
  updatedAt: number;
  /** Agent 在执行过程中的备注 */
  notes?: string;
}

export interface WorkingMemoryRecord {
  /** 主键：canonical URL（见 shared.canonicalizeUrl） */
  canonicalUrl: string;
  /** 关联的当前 visit（打开同 URL 时恢复用） */
  visitId?: string;
  articleId?: string;
  domain?: string;
  /** 当前目标的自然语言描述 */
  activeGoal?: string;
  todos: TodoItem[];
  createdAt: number;
  updatedAt: number;
  /** LRU 时间戳，软 TTL 过期依据 */
  lastAccessedAt: number;
  /** 归档时间（软删除，达到归档的条目在 Episodic 里留副本） */
  archivedAt?: number;
}

/* ------------------------------------------------------------------ */
/* SessionTopic 专属类型（PageVisit 级）                                */
/* ------------------------------------------------------------------ */

export type TopicStage = 'exploring' | 'questioning' | 'summarizing';

export interface SessionTopicRecord {
  /** 主键：visitId */
  visitId: string;
  canonicalUrl?: string;
  articleId?: string;
  /** 当前主题的自然语言描述（注入 system prompt 用） */
  currentTopic: string;
  /** 关键词列表 */
  tags: string[];
  stage?: TopicStage;
  updatedAt: number;
  /** 本 visit 的主题变化历史（审计日志） */
  history: Array<{
    at: number;
    topic: string;
    triggeredBy: 'auto' | 'user_command';
  }>;
}

/* ------------------------------------------------------------------ */
/* ReflectionTask · 反思任务队列                                        */
/* ------------------------------------------------------------------ */

export type ReflectionStatus = 'pending' | 'running' | 'done' | 'failed';
export type ReflectionTaskType =
  | 'visit_summary'
  | 'persona_extraction'
  | 'persona_conflict_check';

export interface ReflectionTask {
  id: string;
  visitId: string;
  taskType: ReflectionTaskType;
  status: ReflectionStatus;
  attemptsCount: number;
  createdAt: number;
  completedAt?: number;
  lastError?: string;
}

/* ------------------------------------------------------------------ */
/* PageVisit · visit 生命周期元数据（agent 层生成，此处仅定义类型）      */
/* ------------------------------------------------------------------ */

export interface PageVisitRecord {
  visitId: string;
  startedAt: number;
  endedAt?: number;
  url: string;
  canonicalUrl: string;
  articleId?: string;
  domain: string;
  title?: string;
}

/* ------------------------------------------------------------------ */
/* MemoryStore 契约                                                    */
/* ------------------------------------------------------------------ */

export interface MemoryStore {
  /**
   * 写入一条记忆记录。
   * 实现需负责（按需）：
   * - 敏感信息过滤（shared.redactSensitive，由调用方或实现内部做）
   * - embedding 可选同步/异步填充
   */
  remember(record: MemoryRecord): Promise<void>;

  /**
   * 按语义/时间/维度召回记忆。
   * 实现约定：limit 默认 10；若 semantic 为空且 types 未指定，召回 visit_summary。
   */
  recall(query: RecallQuery): Promise<MemoryRecord[]>;

  /* --- 以下全部为 v0.2 新增可选方法；NullMemoryStore 提供 no-op 兜底 --- */

  /** 读取指定 canonicalUrl 的 WorkingMemory */
  getWorkingMemory?(canonicalUrl: string): Promise<WorkingMemoryRecord | null>;
  /** 写入（覆盖）WorkingMemory */
  setWorkingMemory?(record: WorkingMemoryRecord): Promise<void>;
  /** 刷新 lastAccessedAt（PageVisit 打开时调用） */
  touchWorkingMemory?(canonicalUrl: string, at?: number): Promise<void>;
  /** LRU 清理：将 lastAccessedAt 超过 ttlMs 的归档 */
  archiveStaleWorkingMemories?(ttlMs: number): Promise<number>;

  /** 列出 Persona 候选/已确认记录 */
  listPersonas?(opts?: { status?: PersonaStatus }): Promise<PersonaRecord[]>;
  /** 新增 Persona 候选 */
  addPersonaCandidate?(candidate: Omit<PersonaRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PersonaRecord>;
  /** 更新 Persona（审核/编辑） */
  updatePersona?(id: string, patch: Partial<PersonaRecord>, reason?: string): Promise<void>;

  /** 写入/覆盖 SessionTopic */
  setSessionTopic?(record: SessionTopicRecord): Promise<void>;
  /** 读取当前 visit 的 SessionTopic */
  getSessionTopic?(visitId: string): Promise<SessionTopicRecord | null>;

  /** 登记反思任务 */
  enqueueReflection?(task: Omit<ReflectionTask, 'id' | 'createdAt' | 'attemptsCount' | 'status'> & {
    id?: string;
    status?: ReflectionStatus;
  }): Promise<ReflectionTask>;
  /** 列出待执行任务（pending + attemptsCount < maxAttempts） */
  listPendingReflections?(maxAttempts?: number): Promise<ReflectionTask[]>;
  /** 更新任务状态 */
  updateReflection?(id: string, patch: Partial<Pick<ReflectionTask, 'status' | 'attemptsCount' | 'completedAt' | 'lastError'>>): Promise<void>;

  /** 写入一次 PageVisit 记录（visit 结束时更新 endedAt） */
  recordPageVisit?(visit: PageVisitRecord): Promise<void>;

  /**
   * 关闭底层资源（Dexie 等）。NullMemoryStore 为 no-op。
   * 主要用于测试隔离。
   */
  close?(): Promise<void>;
}
