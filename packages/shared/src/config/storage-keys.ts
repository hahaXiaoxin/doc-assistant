/**
 * chrome.storage.local 视图:keys / 凭证桶 / 强类型 schema
 * ---------------------------------------------
 * v0.6.0-beta.2 · 拆自原 `config.ts`,只放装配层视角的"存取入口":
 * - `STORAGE_KEYS`:所有写入 chrome.storage.local 的 key 常量
 * - `StorageSchema`:`createTypedStorage<StorageSchema>()` 用的强类型映射
 *
 * 类型契约本身见 `./schema`,默认值见 `./defaults`。
 * 三者由 `./index` 统一 re-export,使用方一律 `from '@doc-assistant/shared'`。
 */

import type {
  ChatSettings,
  EmbeddingProviderConfig,
  LLMProviderConfig,
  MemorySettings,
  ProviderConfigOrRef,
  ProviderCredentialsMap,
  ProviderKind,
} from './schema';

/* ------------------------------------------------------------------ */
/* chrome.storage.local 的 key 常量                                    */
/* ------------------------------------------------------------------ */

export const STORAGE_KEYS = {
  /** 当前启用的主 Provider kind */
  ACTIVE_PROVIDER: 'doc-assistant.active-provider',

  /** 主 Provider 配置(负责主对话) */
  MAIN_PROVIDER_CONFIG: 'doc-assistant.main-provider-config',

  /** 辅助 Provider 配置(主题识别/反思/Intent 精判;可复用主 Provider) */
  AUX_PROVIDER_CONFIG: 'doc-assistant.aux-provider-config',

  /** Embedding Provider 配置(向量化;可复用主 Provider) */
  EMBEDDING_PROVIDER_CONFIG: 'doc-assistant.embedding-provider-config',

  /**
   * 按 Provider 分桶的凭证存储(v0.6.0-beta.2 引入,唯一真源)
   * --------------------------------------------------
   * 形如 `{ qwen: { apiKey, baseURL? }, deepseek: { apiKey, baseURL? } }`。
   * main/aux/embedding 不再各自保存 apiKey/baseURL,一切凭证只从这里读。
   */
  PROVIDER_CREDENTIALS: 'doc-assistant.provider-credentials',

  /** 通用对话设置(maxTurns 等) */
  CHAT_SETTINGS: 'doc-assistant.chat-settings',

  /** 记忆层设置(敏感过滤 / 反思 Job / WorkingMemory TTL 等) */
  MEMORY_SETTINGS: 'doc-assistant.memory-settings',
} as const;

/* ------------------------------------------------------------------ */
/* chrome.storage.local 的强类型 schema 映射                            */
/* ------------------------------------------------------------------ */

/** chrome.storage.local 的强类型 schema 映射 */
export interface StorageSchema extends Record<string, unknown> {
  [STORAGE_KEYS.ACTIVE_PROVIDER]: ProviderKind;
  [STORAGE_KEYS.MAIN_PROVIDER_CONFIG]: LLMProviderConfig;
  [STORAGE_KEYS.AUX_PROVIDER_CONFIG]: ProviderConfigOrRef<LLMProviderConfig>;
  [STORAGE_KEYS.EMBEDDING_PROVIDER_CONFIG]: ProviderConfigOrRef<EmbeddingProviderConfig>;
  [STORAGE_KEYS.PROVIDER_CREDENTIALS]: ProviderCredentialsMap;
  [STORAGE_KEYS.CHAT_SETTINGS]: ChatSettings;
  [STORAGE_KEYS.MEMORY_SETTINGS]: MemorySettings;
}
