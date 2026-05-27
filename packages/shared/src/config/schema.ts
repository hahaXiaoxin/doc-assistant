/**
 * Provider 配置 schema 与契约定义
 * ---------------------------------------------
 * v0.6.0-beta.2 · 拆自原 `config.ts`,只放**契约 / 类型 / 纯辅助**:
 * - `ProviderKind` / `EmbeddingProviderKind` 联合
 * - `LLMProviderConfig` / `EmbeddingProviderConfig` 接口
 * - `ProviderConfigOrRef<T>` 泛型(useMain 复用语义)
 * - `ProviderCredential` / `ChatSettings` / `MemorySettings`
 * - `MAX_TURNS_*` 常量与 `clampMaxTurns` / `isUseMain` 纯函数
 * - 各 Provider "建议模型"列表(`QWEN_MODELS` / `DEEPSEEK_MODELS_SUGGESTED` /
 *   `QWEN_EMBEDDING_MODELS`)——它们是模型字面量类型 alias 的来源,放这里以便
 *   类型派生闭合在 schema 内,避免循环依赖。
 *
 * 默认值放 `./defaults.ts`,storage key / 凭证桶映射 / chrome.storage.local schema
 * 放 `./storage-keys.ts`。三者由 `./index.ts` 统一 re-export。
 *
 * 架构约定:
 * - `ProviderKind` 区分 LLM 提供方(qwen / deepseek / ...),新 Provider 扩展此联合
 * - `EmbeddingProviderKind` 区分 embedding 提供方,与 LLM 解耦
 * - 辅助模型(auxiliary)与 embedding 都支持 `useMain=true` 复用主 Provider 配置
 */

/* ------------------------------------------------------------------ */
/* LLM Provider 配置(主 / 辅助通用结构)                              */
/* ------------------------------------------------------------------ */

/** LLM Provider 种类;未来扩展此联合即可(v0.6.0-beta.2 新增 deepseek) */
export type ProviderKind = 'qwen' | 'deepseek';

/** 千问可选模型(仅 UI 建议值) */
export const QWEN_MODELS = ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen3-max'] as const;
// eslint-disable-next-line @typescript-eslint/ban-types
export type QwenModel = (typeof QWEN_MODELS)[number] | (string & {});

/** DeepSeek 可选模型(仅 UI 建议值) */
export const DEEPSEEK_MODELS_SUGGESTED = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const;
// eslint-disable-next-line @typescript-eslint/ban-types
export type DeepSeekModel = (typeof DEEPSEEK_MODELS_SUGGESTED)[number] | (string & {});

/**
 * 通用 LLM Provider 配置(仅 kind + model + 附加开关)
 * ---
 * apiKey/baseURL 不在此结构内 —— 统一从 `providerCredentials[kind]` 读取。
 *
 * 思考模式开关:**对外统一为 `thinking: boolean`**。Provider 层承担兼容层角色,
 * 在各自子类的 `getProviderOptions()` 里翻译为对应官方 API 形态;装配层 / UI 只
 * 需要关心 on/off 这个布尔语义,无需感知"Qwen 走 extra_body、DeepSeek 走请求体顶层"
 * 这类协议细节。未来若出现"思考力度(effort)"等更丰富的语义再扩展 `thinkingEffort`。
 */
export interface LLMProviderConfig {
  kind: ProviderKind;
  /** 模型名称(自由文本,遵循具体 Provider 命名) */
  model: string;
  /** 是否启用思考模式(各 Provider 内部翻译为官方 API 要求的形态) */
  thinking?: boolean;
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

/** 千问可选 embedding 模型(维度与模型绑定,换模型需清库重建) */
export const QWEN_EMBEDDING_MODELS = ['text-embedding-v2', 'text-embedding-v3'] as const;
// eslint-disable-next-line @typescript-eslint/ban-types
export type QwenEmbeddingModel = (typeof QWEN_EMBEDDING_MODELS)[number] | (string & {});

/**
 * Embedding Provider 配置(不含 apiKey / baseURL;凭证走
 * `providerCredentials` 桶:embedding 与 LLM 共享同一 Provider 的凭证)。
 */
export interface EmbeddingProviderConfig {
  kind: EmbeddingProviderKind;
  model: string;
  /** 向量维度,v2=1536 / v3=1024;用户换模型时 UI 会警告 */
  dimension: number;
}

/* ------------------------------------------------------------------ */
/* 对话设置                                                            */
/* ------------------------------------------------------------------ */

export interface ChatSettings {
  /** 发送给 LLM 的 system prompt */
  systemPrompt: string;
  /** 发送消息时最多携带多少字符的上下文(粗略字符估算) */
  maxContextChars: number;
  /**
   * Agent Loop 最大 tool-call 轮数(默认 8,配置页范围 [3,15])
   * 最后一轮强制不传 tools 兜底,见 packages/agent/src/loop.ts
   */
  maxTurns: number;
}

/** Agent Loop maxTurns 的合法范围 */
export const MAX_TURNS_MIN = 3;
export const MAX_TURNS_MAX = 15;

/**
 * 将任意值夹到 [MIN, MAX] 之间,供 UI/bootstrap 防护输入。
 *
 * 非法输入(undefined / NaN / 字符串等)回退到 8(同 `DEFAULT_CHAT_SETTINGS.maxTurns`)。
 * 这里写死 8 而不是 import `./defaults`,以避免 schema → defaults 反向依赖 ——
 * defaults 已经依赖 schema(用到 `ChatSettings` 类型),如果 schema 反过来引 defaults
 * 就形成循环。
 */
export function clampMaxTurns(n: unknown): number {
  const FALLBACK = 8;
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : FALLBACK;
  if (v < MAX_TURNS_MIN) return MAX_TURNS_MIN;
  if (v > MAX_TURNS_MAX) return MAX_TURNS_MAX;
  return v;
}

/* ------------------------------------------------------------------ */
/* 记忆层设置                                                          */
/* ------------------------------------------------------------------ */

export interface MemorySettings {
  /** 启用敏感信息过滤(email / 手机号 / 身份证 / apiKey / 信用卡号 → [REDACTED]) */
  sensitiveFilterEnabled: boolean;
  /** 启用反思 Job(visit_summary 生成 / Persona 候选抽取) */
  reflectionEnabled: boolean;
  /** WorkingMemory 软 TTL 天数,达到后归档而非立即删 */
  workingMemoryTtlDays: number;
  /** Persona 自动确认门槛:反思命中同一条 ≥ 该次数则自动 confirmed */
  personaAutoConfirmHits: number;
}

/* ------------------------------------------------------------------ */
/* Provider 凭证(类型契约,实际默认值与 storage 视图分别在邻居文件)  */
/* ------------------------------------------------------------------ */

/**
 * 按 Provider 分桶的凭证(唯一真源,main/aux/embedding 自身不含 apiKey/baseURL)
 * ---------------------------------------------
 * 每个 Provider kind 保留一份 `{ apiKey, baseURL? }`,切换 Provider 时
 * 自动从桶里带出对应值,避免"切 Provider 要重填 Key"的坏体验。
 *
 * 设计要点:
 * - baseURL 可选:未改过默认值时不写入桶,读时回落到 Provider registry 默认值。
 * - Embedding 与 LLM 公用一个 Provider 的凭证桶(例如 Qwen 的 apiKey 对
 *   LLM / embedding 共用)——这也和 UI 层"embedding useMain=true 复用主
 *   Provider 凭证"的语义一致。
 */
export interface ProviderCredential {
  apiKey: string;
  baseURL?: string;
}

export type ProviderCredentialsMap = Partial<Record<ProviderKind, ProviderCredential>>;
