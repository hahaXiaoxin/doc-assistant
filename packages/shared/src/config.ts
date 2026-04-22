/**
 * Provider 配置与 chrome.storage.local schema
 * ---------------------------------------------
 * v0.2 · 三套 Provider（main / auxiliary / embedding）+ MemorySettings
 * - 所有 Provider 的配置都存 chrome.storage.local
 * - API Key 严禁写日志、严禁写 IndexedDB
 * - 旧 v0.1 的 `QWEN_CONFIG` 读取路径保留一版，bootstrap 时自动迁移到 MAIN_PROVIDER_CONFIG
 *
 * 架构约定：
 * - `ProviderKind` 区分 LLM 提供方（qwen / openai / ...），新 Provider 扩展此联合
 * - `EmbeddingProviderKind` 区分 embedding 提供方，与 LLM 解耦
 * - 辅助模型（auxiliary）与 embedding 都支持 `useMain=true` 复用主 Provider 配置
 */

export const STORAGE_KEYS = {
  /** 当前启用的主 Provider kind */
  ACTIVE_PROVIDER: 'doc-assistant.active-provider',

  /**
   * v0.1 遗留：千问 Provider 配置
   * @deprecated v0.2 bootstrap 会把它迁移到 MAIN_PROVIDER_CONFIG；读取路径仍保留，写入一律写新 key。
   */
  QWEN_CONFIG: 'doc-assistant.qwen-config',

  /** v0.2 新增：主 Provider 配置（负责主对话） */
  MAIN_PROVIDER_CONFIG: 'doc-assistant.main-provider-config',

  /** v0.2 新增：辅助 Provider 配置（主题识别/反思/Intent 精判；可复用主 Provider） */
  AUX_PROVIDER_CONFIG: 'doc-assistant.aux-provider-config',

  /** v0.2 新增：Embedding Provider 配置（向量化；可复用主 Provider） */
  EMBEDDING_PROVIDER_CONFIG: 'doc-assistant.embedding-provider-config',

  /** 通用对话设置（maxTurns 等） */
  CHAT_SETTINGS: 'doc-assistant.chat-settings',

  /** v0.2 新增：记忆层设置（敏感过滤 / 反思 Job / WorkingMemory TTL 等） */
  MEMORY_SETTINGS: 'doc-assistant.memory-settings',
} as const;

/* ------------------------------------------------------------------ */
/* LLM Provider 配置（主 / 辅助通用结构）                              */
/* ------------------------------------------------------------------ */

/** LLM Provider 种类；未来扩展此联合即可 */
export type ProviderKind = 'qwen';

/** 千问可选模型（仅 UI 建议值，baseURL 允许任意字符串） */
export const QWEN_MODELS = ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen3-max'] as const;
// eslint-disable-next-line @typescript-eslint/ban-types
export type QwenModel = (typeof QWEN_MODELS)[number] | (string & {});

/**
 * 通用 LLM Provider 配置
 * ---
 * 统一的 `baseUrl + model + apiKey` 规范，兼容云端与本地模型。
 * v0.1 的 `QwenConfig` 是此类型的一种具体形态（kind=qwen + enableThinking）。
 */
export interface LLMProviderConfig {
  kind: ProviderKind;
  /** 兼容 OpenAI 协议的端点 */
  baseURL: string;
  /** 模型名称（自由文本，遵循具体 Provider 命名） */
  model: string;
  /** API Key（敏感，严禁日志/IDB） */
  apiKey: string;
  /** 是否启用思考模式（qwen 特有，其它 Provider 忽略） */
  enableThinking?: boolean;
}

/**
 * 辅助/Embedding Provider 的"复用主 Provider"开关
 * 存储形如 `{ useMain: true }` 或完整 `LLMProviderConfig`
 */
export type ProviderConfigOrRef<T> = { useMain: true } | T;

/** 判定 ProviderConfigOrRef 是否处于"复用主 Provider"状态 */
export function isUseMain<T>(v: ProviderConfigOrRef<T> | undefined): v is { useMain: true } {
  return !!v && typeof v === 'object' && (v as { useMain?: boolean }).useMain === true;
}

/* ------------------------------------------------------------------ */
/* Embedding Provider 配置                                             */
/* ------------------------------------------------------------------ */

/** Embedding Provider 种类 */
export type EmbeddingProviderKind = 'qwen-embedding';

/** 千问可选 embedding 模型（维度与模型绑定，换模型需清库重建） */
export const QWEN_EMBEDDING_MODELS = ['text-embedding-v2', 'text-embedding-v3'] as const;
// eslint-disable-next-line @typescript-eslint/ban-types
export type QwenEmbeddingModel = (typeof QWEN_EMBEDDING_MODELS)[number] | (string & {});

export interface EmbeddingProviderConfig {
  kind: EmbeddingProviderKind;
  baseURL: string;
  model: string;
  apiKey: string;
  /** 向量维度，v2=1536 / v3=1024；用户换模型时 UI 会警告 */
  dimension: number;
}

/* ------------------------------------------------------------------ */
/* 默认配置                                                            */
/* ------------------------------------------------------------------ */

/** v0.1 遗留：兼容旧存储格式，读取时使用 */
export interface QwenConfig {
  apiKey: string;
  baseURL: string;
  model: QwenModel;
  enableThinking: boolean;
}

export const DEFAULT_QWEN_CONFIG: QwenConfig = {
  apiKey: '',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen-plus',
  enableThinking: true,
};

/** v0.2 默认主 Provider 配置（kind=qwen） */
export const DEFAULT_MAIN_PROVIDER_CONFIG: LLMProviderConfig = {
  kind: 'qwen',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen-plus',
  apiKey: '',
  enableThinking: true,
};

/** v0.2 默认辅助 Provider 配置：默认"复用主 Provider" */
export const DEFAULT_AUX_PROVIDER_CONFIG: ProviderConfigOrRef<LLMProviderConfig> = {
  useMain: true,
};

/** v0.2 默认 Embedding Provider 配置：默认"复用主 Provider"的 baseURL+apiKey，model 用 v2 */
export const DEFAULT_EMBEDDING_PROVIDER_CONFIG: ProviderConfigOrRef<EmbeddingProviderConfig> = {
  useMain: true,
};

/** 非 useMain 时 embedding provider 的填空默认值（UI 取消"复用主 Provider"时使用） */
export const DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK: EmbeddingProviderConfig = {
  kind: 'qwen-embedding',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'text-embedding-v2',
  apiKey: '',
  dimension: 1536,
};

/* ------------------------------------------------------------------ */
/* 对话设置（含 v0.2 新增 maxTurns）                                   */
/* ------------------------------------------------------------------ */

export interface ChatSettings {
  /** 发送给 LLM 的 system prompt */
  systemPrompt: string;
  /** 发送消息时最多携带多少字符的上下文（粗略字符估算，v0.2 仍按字符） */
  maxContextChars: number;
  /**
   * Agent Loop 最大 tool-call 轮数（v0.2 默认 8，配置页范围 [3,15]）
   * 最后一轮强制不传 tools 兜底，见 packages/agent/src/loop.ts
   */
  maxTurns: number;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  systemPrompt:
    '你是一名专业、克制、擅长讲解文档的学习助手。基于用户当前阅读的网页内容回答问题；回答要简明、结构化；当信息不足时主动提问澄清，避免臆测。',
  maxContextChars: 8000,
  maxTurns: 8,
};

/** Agent Loop maxTurns 的合法范围 */
export const MAX_TURNS_MIN = 3;
export const MAX_TURNS_MAX = 15;

/** 将任意值夹到 [MIN, MAX] 之间，供 UI/bootstrap 防护输入 */
export function clampMaxTurns(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : DEFAULT_CHAT_SETTINGS.maxTurns;
  if (v < MAX_TURNS_MIN) return MAX_TURNS_MIN;
  if (v > MAX_TURNS_MAX) return MAX_TURNS_MAX;
  return v;
}

/* ------------------------------------------------------------------ */
/* 记忆层设置（v0.2 新增）                                              */
/* ------------------------------------------------------------------ */

export interface MemorySettings {
  /** 启用敏感信息过滤（email / 手机号 / 身份证 / apiKey / 信用卡号 → [REDACTED]） */
  sensitiveFilterEnabled: boolean;
  /** 启用反思 Job（visit_summary 生成 / Persona 候选抽取） */
  reflectionEnabled: boolean;
  /** WorkingMemory 软 TTL 天数，达到后归档而非立即删 */
  workingMemoryTtlDays: number;
  /** Persona 自动确认门槛：反思命中同一条 ≥ 该次数则自动 confirmed */
  personaAutoConfirmHits: number;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  sensitiveFilterEnabled: true,
  reflectionEnabled: true,
  workingMemoryTtlDays: 30,
  personaAutoConfirmHits: 3,
};

/* ------------------------------------------------------------------ */
/* chrome.storage.local 的强类型 schema                                */
/* ------------------------------------------------------------------ */

/**
 * chrome.storage.local 的强类型 schema 映射
 * v0.1 的 `QWEN_CONFIG` 保留用于迁移读取，写入一律写新 key。
 */
export interface StorageSchema extends Record<string, unknown> {
  [STORAGE_KEYS.ACTIVE_PROVIDER]: ProviderKind;
  /** v0.1 遗留字段，仅用于迁移读取；新代码不写入 */
  [STORAGE_KEYS.QWEN_CONFIG]: QwenConfig;
  [STORAGE_KEYS.MAIN_PROVIDER_CONFIG]: LLMProviderConfig;
  [STORAGE_KEYS.AUX_PROVIDER_CONFIG]: ProviderConfigOrRef<LLMProviderConfig>;
  [STORAGE_KEYS.EMBEDDING_PROVIDER_CONFIG]: ProviderConfigOrRef<EmbeddingProviderConfig>;
  [STORAGE_KEYS.CHAT_SETTINGS]: ChatSettings;
  [STORAGE_KEYS.MEMORY_SETTINGS]: MemorySettings;
}

/* ------------------------------------------------------------------ */
/* v0.1 → v0.2 迁移                                                    */
/* ------------------------------------------------------------------ */

/**
 * 将 v0.1 的 QwenConfig 迁移为 v0.2 的 LLMProviderConfig
 * 用于 bootstrap 时首次启动：若 MAIN_PROVIDER_CONFIG 未设置但 QWEN_CONFIG 存在，则迁移。
 */
export function migrateQwenConfigToMain(old: QwenConfig): LLMProviderConfig {
  return {
    kind: 'qwen',
    baseURL: old.baseURL,
    model: old.model,
    apiKey: old.apiKey,
    enableThinking: old.enableThinking,
  };
}
