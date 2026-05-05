/**
 * 导出包脱敏(v0.6.0)
 * ---------------------------------------------
 * 内测 Debug 包导出前的最后一道闸。
 *
 * 与 `sensitive-filter.ts` 的区别:
 * - `sensitive-filter.ts` 是**文本级**的兜底(正则扫 sk-/ghp_/ApiKey 等)
 * - 本文件是**结构化字段级**脱敏——按数据模型针对特定字段做硬处理
 *
 * 本轮脱敏强度(用户拍板;见 PR-5 决策):
 * 硬敏感(全部替换):
 * - API Key(所有 provider)→ 整字段移除或 `[REDACTED:api_key]`
 * - baseURL → 只保留 host;路径 → `https://host.example.com/***`
 * - 对话原文(`episodes_msg.content`)→ `[REDACTED:text,len=N]`
 * - 页面 URL 原文 → 只保留 host,path → `https://host/***`
 * - 页面正文 → 不导出(本文件不接收,由导出侧决定)
 * - persona 原文 → `[REDACTED:persona,subject=user|agent,len=N]`
 * - visit_summary 原文 → `[REDACTED:summary,len=N]`
 *
 * 保留(用户要求排查方便):
 * - ChatSettings.systemPrompt 原文
 * - PageVisitRecord.title 原文
 * - WorkingMemoryRecord.activeGoal / todos[].content 原文
 * - SessionTopicRecord.currentTopic / tags 原文
 *
 * 保留的结构化信息:
 * - 记录条数分布 / 时间戳 / subject / type / host 等元数据
 *
 * 最终兜底:
 * - `sanitizeExportJson` 在返回前对整个 JSON 字符串跑一次 `redactSensitiveText`,
 *   确保即便用户手工把 `sk-xxx` 塞进 systemPrompt 之类"保留字段",
 *   文本级正则也会兜住。
 */
import { redactSensitiveText } from './sensitive-filter';

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

/** 最精简的 Provider 配置视图(兼容 main / aux / embedding) */
export interface SanitizableProviderConfig {
  kind?: string;
  baseURL?: string;
  model?: string;
  apiKey?: string;
  dimension?: number;
  enableThinking?: boolean;
  /** aux / embedding 可能是 `{useMain: true}` */
  useMain?: true;
}

export interface SanitizableMemoryRecord {
  id: string;
  type: 'message' | 'persona' | 'visit_summary' | string;
  content: string;
  timestamp: number;
  domain?: string;
  url?: string;
  canonicalUrl?: string;
  topic?: string[];
  visitId?: string;
  orderInVisit?: number;
  role?: string;
  articleId?: string;
  parentId?: string;
  references?: string[];
  meta?: Record<string, unknown>;
}

export interface SanitizablePersonaRecord {
  id: string;
  subject: 'user' | 'agent' | string;
  content: string;
  status: string;
  confidence: number;
  hitCount: number;
  reviewedByUser: boolean;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
}

export interface SanitizableWorkingMemoryRecord {
  canonicalUrl: string;
  visitId?: string;
  articleId?: string;
  domain?: string;
  activeGoal?: string;
  todos: Array<{
    id: string;
    content: string;
    status: string;
    priority?: string;
    createdAt: number;
    updatedAt: number;
    notes?: string;
  }>;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  archivedAt?: number;
}

export interface SanitizableSessionTopicRecord {
  visitId: string;
  canonicalUrl?: string;
  articleId?: string;
  currentTopic: string;
  tags: string[];
  stage?: string;
  updatedAt: number;
  history?: Array<{ at: number; topic: string; triggeredBy?: string }>;
}

export interface SanitizablePageVisitRecord {
  visitId: string;
  startedAt: number;
  endedAt?: number;
  url: string;
  canonicalUrl: string;
  articleId?: string;
  domain: string;
  title?: string;
}

/** 导出包的聚合结构(各字段都可选——调用方可只导出部分) */
export interface ExportableBundle {
  exportedAt: number;
  version?: string;
  providers?: {
    main?: SanitizableProviderConfig;
    aux?: SanitizableProviderConfig;
    embedding?: SanitizableProviderConfig;
  };
  chatSettings?: {
    systemPrompt?: string;
    maxTurns?: number;
    [k: string]: unknown;
  };
  memorySettings?: Record<string, unknown>;
  memory?: {
    episodes_msg?: SanitizableMemoryRecord[];
    episodes_visit_summary?: SanitizableMemoryRecord[];
    persona?: SanitizablePersonaRecord[];
    working_memories?: SanitizableWorkingMemoryRecord[];
    session_topics?: SanitizableSessionTopicRecord[];
    page_visits?: SanitizablePageVisitRecord[];
  };
  /** 可选:日志(本模块不改 entries,交由上层决定;最终 JSON 兜底正则会跑在它上面) */
  logs?: unknown;
}

/* ------------------------------------------------------------------ */
/* 工具:URL 脱敏(只保留 host)                                         */
/* ------------------------------------------------------------------ */

/**
 * 对任意 URL 做 host-only 脱敏。
 * - 解析失败 → 返回 `[REDACTED:url]`
 * - 成功 → `${protocol}//${host}/***`(path/query/hash 全部抹掉)
 */
export function redactUrlKeepHost(url: string | undefined): string {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/***`;
  } catch {
    return '[REDACTED:url]';
  }
}

/* ------------------------------------------------------------------ */
/* Provider 配置脱敏                                                   */
/* ------------------------------------------------------------------ */

export function sanitizeProviderConfig(
  cfg: SanitizableProviderConfig | undefined,
): SanitizableProviderConfig | undefined {
  if (!cfg) return undefined;
  // useMain 引用,不包含实际敏感字段
  if (cfg.useMain === true) return { useMain: true };
  const out: SanitizableProviderConfig = {};
  if (cfg.kind !== undefined) out.kind = cfg.kind;
  if (cfg.baseURL !== undefined) out.baseURL = redactUrlKeepHost(cfg.baseURL);
  if (cfg.model !== undefined) out.model = cfg.model;
  if (cfg.dimension !== undefined) out.dimension = cfg.dimension;
  if (cfg.enableThinking !== undefined) out.enableThinking = cfg.enableThinking;
  // API Key 永远替换成占位符,即便原值是空字符串
  out.apiKey = cfg.apiKey ? '[REDACTED:api_key]' : '';
  return out;
}

/* ------------------------------------------------------------------ */
/* MemoryRecord 脱敏                                                   */
/* ------------------------------------------------------------------ */

/**
 * 对 MemoryRecord 做按 type 的硬脱敏:
 * - 'message'           content → [REDACTED:text,len=N]
 * - 'visit_summary'     content → [REDACTED:summary,len=N]
 * - 'persona'           content → [REDACTED:persona,...]  (同时调用 sanitizePersonaRecord)
 *
 * 同时:
 * - url / canonicalUrl 只保留 host
 * - embedding 字段(若存在)被移除(非 JSON 友好,且本身是敏感内容的函数)
 */
export function sanitizeMemoryRecord(
  r: SanitizableMemoryRecord,
): SanitizableMemoryRecord {
  const out: SanitizableMemoryRecord = {
    id: r.id,
    type: r.type,
    timestamp: r.timestamp,
    content: '',
  };
  // content 按类型替换
  const len = typeof r.content === 'string' ? r.content.length : 0;
  if (r.type === 'message') {
    out.content = `[REDACTED:text,len=${len}]`;
  } else if (r.type === 'visit_summary') {
    out.content = `[REDACTED:summary,len=${len}]`;
  } else if (r.type === 'persona') {
    out.content = `[REDACTED:persona,len=${len}]`;
  } else {
    out.content = `[REDACTED:content,len=${len}]`;
  }
  // url / canonicalUrl
  if (r.url !== undefined) out.url = redactUrlKeepHost(r.url);
  if (r.canonicalUrl !== undefined) out.canonicalUrl = redactUrlKeepHost(r.canonicalUrl);
  // 元数据(非敏感)
  if (r.domain !== undefined) out.domain = r.domain;
  if (r.topic !== undefined) out.topic = r.topic.slice();
  if (r.visitId !== undefined) out.visitId = r.visitId;
  if (r.orderInVisit !== undefined) out.orderInVisit = r.orderInVisit;
  if (r.role !== undefined) out.role = r.role;
  if (r.articleId !== undefined) out.articleId = r.articleId;
  if (r.parentId !== undefined) out.parentId = r.parentId;
  if (r.references !== undefined) out.references = r.references.slice();
  // meta 浅拷贝(去掉潜在的大字段);embedding 不保留
  if (r.meta && typeof r.meta === 'object') {
    const metaCopy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.meta)) {
      if (k === 'embedding') continue;
      metaCopy[k] = v;
    }
    out.meta = metaCopy;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Persona 脱敏                                                        */
/* ------------------------------------------------------------------ */

export function sanitizePersonaRecord(
  p: SanitizablePersonaRecord,
): SanitizablePersonaRecord {
  const len = typeof p.content === 'string' ? p.content.length : 0;
  const out: SanitizablePersonaRecord = {
    id: p.id,
    subject: p.subject,
    content: `[REDACTED:persona,subject=${p.subject},len=${len}]`,
    status: p.status,
    confidence: p.confidence,
    hitCount: p.hitCount,
    reviewedByUser: p.reviewedByUser,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
  if (p.tags !== undefined) out.tags = p.tags.slice();
  return out;
}

/* ------------------------------------------------------------------ */
/* WorkingMemory 脱敏(按用户要求保留 activeGoal / todos[].content)    */
/* ------------------------------------------------------------------ */

export function sanitizeWorkingMemoryRecord(
  w: SanitizableWorkingMemoryRecord,
): SanitizableWorkingMemoryRecord {
  const out: SanitizableWorkingMemoryRecord = {
    canonicalUrl: redactUrlKeepHost(w.canonicalUrl),
    todos: w.todos.map((t) => ({ ...t })),
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    lastAccessedAt: w.lastAccessedAt,
  };
  if (w.visitId !== undefined) out.visitId = w.visitId;
  if (w.articleId !== undefined) out.articleId = w.articleId;
  if (w.domain !== undefined) out.domain = w.domain;
  // activeGoal 保留原文(用户排查方便)
  if (w.activeGoal !== undefined) out.activeGoal = w.activeGoal;
  if (w.archivedAt !== undefined) out.archivedAt = w.archivedAt;
  return out;
}

/* ------------------------------------------------------------------ */
/* SessionTopic 脱敏(保留原文)                                        */
/* ------------------------------------------------------------------ */

export function sanitizeSessionTopicRecord(
  s: SanitizableSessionTopicRecord,
): SanitizableSessionTopicRecord {
  const out: SanitizableSessionTopicRecord = {
    visitId: s.visitId,
    currentTopic: s.currentTopic, // 保留
    tags: s.tags.slice(), // 保留
    updatedAt: s.updatedAt,
  };
  if (s.canonicalUrl !== undefined) out.canonicalUrl = redactUrlKeepHost(s.canonicalUrl);
  if (s.articleId !== undefined) out.articleId = s.articleId;
  if (s.stage !== undefined) out.stage = s.stage;
  if (s.history !== undefined) out.history = s.history.map((h) => ({ ...h })); // topic 保留
  return out;
}

/* ------------------------------------------------------------------ */
/* PageVisit 脱敏(URL 只留 host;title 保留)                          */
/* ------------------------------------------------------------------ */

export function sanitizePageVisitRecord(
  v: SanitizablePageVisitRecord,
): SanitizablePageVisitRecord {
  const out: SanitizablePageVisitRecord = {
    visitId: v.visitId,
    startedAt: v.startedAt,
    url: redactUrlKeepHost(v.url),
    canonicalUrl: redactUrlKeepHost(v.canonicalUrl),
    domain: v.domain,
  };
  if (v.endedAt !== undefined) out.endedAt = v.endedAt;
  if (v.articleId !== undefined) out.articleId = v.articleId;
  // title 保留原文
  if (v.title !== undefined) out.title = v.title;
  return out;
}

/* ------------------------------------------------------------------ */
/* 顶层 bundle 脱敏 + JSON 兜底                                         */
/* ------------------------------------------------------------------ */

/**
 * 对完整 bundle 做结构化脱敏;**不包含**最后的文本兜底。
 * 仅供单测直接断言字段级行为用;生产导出请用 `sanitizeExportJson`。
 */
export function sanitizeExportBundle(bundle: ExportableBundle): ExportableBundle {
  const out: ExportableBundle = {
    exportedAt: bundle.exportedAt,
  };
  if (bundle.version !== undefined) out.version = bundle.version;

  if (bundle.providers) {
    const p: NonNullable<ExportableBundle['providers']> = {};
    const m = sanitizeProviderConfig(bundle.providers.main);
    if (m) p.main = m;
    const a = sanitizeProviderConfig(bundle.providers.aux);
    if (a) p.aux = a;
    const e = sanitizeProviderConfig(bundle.providers.embedding);
    if (e) p.embedding = e;
    out.providers = p;
  }

  // ChatSettings:systemPrompt 原文保留(用户决策);其它字段透传
  if (bundle.chatSettings) {
    out.chatSettings = { ...bundle.chatSettings };
  }

  // MemorySettings:元配置,非敏感,透传
  if (bundle.memorySettings) {
    out.memorySettings = { ...bundle.memorySettings };
  }

  if (bundle.memory) {
    out.memory = {};
    if (bundle.memory.episodes_msg)
      out.memory.episodes_msg = bundle.memory.episodes_msg.map(sanitizeMemoryRecord);
    if (bundle.memory.episodes_visit_summary)
      out.memory.episodes_visit_summary = bundle.memory.episodes_visit_summary.map(
        sanitizeMemoryRecord,
      );
    if (bundle.memory.persona)
      out.memory.persona = bundle.memory.persona.map(sanitizePersonaRecord);
    if (bundle.memory.working_memories)
      out.memory.working_memories = bundle.memory.working_memories.map(
        sanitizeWorkingMemoryRecord,
      );
    if (bundle.memory.session_topics)
      out.memory.session_topics = bundle.memory.session_topics.map(
        sanitizeSessionTopicRecord,
      );
    if (bundle.memory.page_visits)
      out.memory.page_visits = bundle.memory.page_visits.map(sanitizePageVisitRecord);
  }

  if (bundle.logs !== undefined) out.logs = bundle.logs;

  return out;
}

/**
 * 导出流水入口。
 *
 * 1. 结构化脱敏(本文件内定义的字段级规则)
 * 2. JSON.stringify
 * 3. **对整个 JSON 字符串跑 redactSensitiveText 兜底**——确保即便用户把
 *    sk-xxx 塞进了保留字段(systemPrompt / todos / activeGoal / title 等),
 *    文本级正则仍能抓住
 *
 * 返回最终的 JSON 字符串(pretty-print,便于人工审计)。
 */
export function sanitizeExportJson(bundle: ExportableBundle, indent = 2): string {
  const structured = sanitizeExportBundle(bundle);
  const raw = JSON.stringify(structured, null, indent);
  // 最后的文本兜底
  return redactSensitiveText(raw);
}
