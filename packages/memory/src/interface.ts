/**
 * MemoryStore 接口
 * ---------------------------------------------
 * 职责：长期/工作/情景/个性 四层记忆的写入与召回。
 *
 * v0.2 Phase2：DexieMemoryStore 落地（详见 docs/ROADMAP.md §2 与 test-prompt.md 定稿）
 *   - IndexedDB 持久化（Dexie）
 *   - 千问 embedding 向量化
 *   - recall() 支持语义查询（向量余弦） + 时间/域名/话题过滤
 *   - Persona / WorkingMemory / SessionTopic / ReflectionTask 专属 API（全部必填，
 *     NullMemoryStore 提供 no-op 兜底）
 *
 * 契约稳定性承诺：
 * - `remember()` / `recall()` 签名不得修改（只能新增可选参数）
 * - MemoryStore 上的方法实现必须**幂等且可重复调用**：同一参数多次调用不引入副作用差异
 *   （例如 setWorkingMemory 覆盖不累加、updatePersona 以 id 为主键幂等等）
 */

/* ------------------------------------------------------------------ */
/* 核心 MemoryRecord                                                    */
/* ------------------------------------------------------------------ */

/**
 * 记忆条目类型。
 * - 'message'：对话消息原文（episodes_msg）
 * - 'persona'：长期指令/身份（persona 表）
 * - 'visit_summary'：PageVisit 摘要（episodes_visit_summary）
 */
export type MemoryRecordType = 'message' | 'persona' | 'visit_summary';

export interface MemoryRecord {
  id: string;
  type: MemoryRecordType;
  content: string;
  /** 向量（visit_summary 写入，其它类型按需） */
  embedding?: Float32Array;
  /** 时间戳（毫秒） */
  timestamp: number;

  // 索引维度（通用）
  articleId?: string;
  domain?: string;
  url?: string;
  topic?: string[];

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

/**
 * Persona 主体视角（v0.4.0 新增必填）。
 * - 'agent'：**对 agent 的定义**——身份、角色、性格、能力边界、行为方式。
 *   例如"你叫小瑾，是文档阅读助手"、"你回答要简洁"、"你的语气偏技术向"。
 * - 'user'：**对 user 的定义**——身份、背景、偏好。
 *   例如"用户是前端工程师"、"用户偏好 TypeScript"、"用户母语是中文"。
 *
 * 两类定义协同工作：agent 知道用户是前端，就用前端术语举例；
 * 知道用户偏好简洁，就少讲废话。user 侧的定义直接影响 agent 如何表达。
 */
export type PersonaSubject = 'agent' | 'user';

export interface PersonaSource {
  /** 哪次 visit 推出的 */
  visitId?: string;
  /** 信号来源的消息 id 列表 */
  messageIds?: string[];
  /** 抽取方式：反思归纳 | 用户显式声明 */
  extractedBy: 'reflection' | 'user_explicit';
}

export interface PersonaRecord {
  id: string;
  /**
   * 主体视角（v0.4.0 新增必填）。
   * 每条 Persona 都在回答"**这是在定义谁**"：
   * - 'agent'：对 agent 的定义（身份、角色、性格、能力边界、行为方式）
   * - 'user'：对 user 的定义（身份、背景、偏好）
   */
  subject: PersonaSubject;
  /**
   * Persona 的具体定义内容——一条写给 LLM 看的陈述/祈使句。
   *
   * v0.4.0 起由 `subject` 字段标注这条定义指向谁（agent 自己 / 用户本人），
   * 内容保持原貌，不再像 v0.2.2 那样强制把用户的背景转译为 agent 指令。
   *
   * 示例：
   * - subject='agent' · "你叫小瑾，是我的文档阅读助手"（定义 agent 身份）
   * - subject='agent' · "你回答要简洁，少讲废话"（定义 agent 行为方式）
   * - subject='user'  · "用户是前端工程师"（定义用户身份）
   * - subject='user'  · "用户偏好 TypeScript"（定义用户偏好）
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

  /**
   * 按 id 删除一条 MemoryRecord（含 visit_summary / message / persona），
   * 主要供记忆浏览器 UI 的单条删除使用。
   *
   * 语义：幂等——不存在该 id 不抛错，实现方应遍历相关表删除。
   */
  deleteRecord(id: string): Promise<void>;

  /**
   * 列出 visit_summary 摘要清单（按 timestamp 倒序），用于记忆浏览器 Tab。
   * 只读，不做向量召回；可选时间窗 / limit 过滤。
   */
  listVisitSummaries(opts?: {
    timeRange?: [number, number];
    limit?: number;
  }): Promise<MemoryRecord[]>;

  /**
   * 列出 SessionTopic 清单（按 updatedAt 倒序），用于记忆浏览器 Tab。
   */
  listSessionTopics(opts?: { limit?: number }): Promise<SessionTopicRecord[]>;

  /**
   * 列出所有 WorkingMemory 记录（含已归档），主要供记忆浏览器展示。
   * 按 lastAccessedAt 倒序。
   */
  listWorkingMemories(opts?: { limit?: number }): Promise<WorkingMemoryRecord[]>;

  /**
   * 按 canonicalUrl 删除一条 WorkingMemory（幂等）。
   */
  deleteWorkingMemory(canonicalUrl: string): Promise<void>;

  /* --- v0.3.0 起以下方法全部必填；NullMemoryStore 提供 no-op 实现 --- */

  /** 读取指定 canonicalUrl 的 WorkingMemory */
  getWorkingMemory(canonicalUrl: string): Promise<WorkingMemoryRecord | null>;
  /** 写入（覆盖）WorkingMemory */
  setWorkingMemory(record: WorkingMemoryRecord): Promise<void>;
  /** 刷新 lastAccessedAt（PageVisit 打开时调用） */
  touchWorkingMemory(canonicalUrl: string, at?: number): Promise<void>;
  /** LRU 清理：将 lastAccessedAt 超过 ttlMs 的归档 */
  archiveStaleWorkingMemories(ttlMs: number): Promise<number>;

  /** 列出 Persona 候选/已确认记录（可按 status / subject 过滤） */
  listPersonas(opts?: { status?: PersonaStatus; subject?: PersonaSubject }): Promise<PersonaRecord[]>;
  /** 新增 Persona 候选 */
  addPersonaCandidate(candidate: Omit<PersonaRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PersonaRecord>;
  /** 更新 Persona（审核/编辑） */
  updatePersona(id: string, patch: Partial<PersonaRecord>, reason?: string): Promise<void>;

  /** 写入/覆盖 SessionTopic */
  setSessionTopic(record: SessionTopicRecord): Promise<void>;
  /** 读取当前 visit 的 SessionTopic */
  getSessionTopic(visitId: string): Promise<SessionTopicRecord | null>;

  /** 登记反思任务 */
  enqueueReflection(task: Omit<ReflectionTask, 'id' | 'createdAt' | 'attemptsCount' | 'status'> & {
    id?: string;
    status?: ReflectionStatus;
  }): Promise<ReflectionTask>;
  /** 列出待执行任务（pending + attemptsCount < maxAttempts） */
  listPendingReflections(maxAttempts?: number): Promise<ReflectionTask[]>;
  /** 更新任务状态 */
  updateReflection(id: string, patch: Partial<Pick<ReflectionTask, 'status' | 'attemptsCount' | 'completedAt' | 'lastError'>>): Promise<void>;

  /** 写入一次 PageVisit 记录（visit 结束时更新 endedAt） */
  recordPageVisit(visit: PageVisitRecord): Promise<void>;
  /**
   * 按 visitId 读取 PageVisit 元数据（主要给反思 Job 补 title 用）。
   * 不存在返回 null；NullMemoryStore / 无 IDB 环境下始终返回 null。
   */
  getPageVisit(visitId: string): Promise<PageVisitRecord | null>;

  /**
   * 关闭底层资源（Dexie 等）。NullMemoryStore 为 no-op。
   * 主要用于测试隔离。
   */
  close(): Promise<void>;
}
