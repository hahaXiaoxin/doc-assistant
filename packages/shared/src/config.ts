/**
 * Provider 配置类型
 * ---------------------------------------------
 * - 所有 Provider 的配置都存 chrome.storage.local
 * - API Key 严禁写日志、严禁写 IndexedDB
 * - 未来新增 Provider 时，扩展 `ProviderKind` 联合与 `ProviderConfigMap`
 */

export const STORAGE_KEYS = {
  /** 当前启用的 Provider kind */
  ACTIVE_PROVIDER: 'doc-assistant.active-provider',
  /** Qwen Provider 配置 */
  QWEN_CONFIG: 'doc-assistant.qwen-config',
  /** 通用对话设置 */
  CHAT_SETTINGS: 'doc-assistant.chat-settings',
} as const;

/** 目前仅支持千问；未来扩展此联合 */
export type ProviderKind = 'qwen';

/** 千问可选模型（仅 UI 建议值，实际 baseURL 会接受任意字符串） */
export const QWEN_MODELS = ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen3-max'] as const;
// eslint-disable-next-line @typescript-eslint/ban-types
export type QwenModel = (typeof QWEN_MODELS)[number] | (string & {});

export interface QwenConfig {
  /** 千问 API Key（DashScope / 百炼） */
  apiKey: string;
  /** 兼容 OpenAI 协议的端点，默认 dashscope */
  baseURL: string;
  /** 模型名，默认 qwen-plus */
  model: QwenModel;
  /** 是否启用思考模式（reasoning_content） */
  enableThinking: boolean;
}

export const DEFAULT_QWEN_CONFIG: QwenConfig = {
  apiKey: '',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen-plus',
  enableThinking: true,
};

export interface ChatSettings {
  /** 发送给 LLM 的 system prompt */
  systemPrompt: string;
  /** 发送消息时最多携带多少字符的上下文（粗略字符估算，MVP 不做 tokenizer） */
  maxContextChars: number;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  systemPrompt:
    '你是一名专业、克制、擅长讲解文档的学习助手。基于用户当前阅读的网页内容回答问题；回答要简明、结构化；当信息不足时主动提问澄清，避免臆测。',
  maxContextChars: 8000,
};

/** chrome.storage.local 的强类型 schema 映射 */
export interface StorageSchema extends Record<string, unknown> {
  [STORAGE_KEYS.ACTIVE_PROVIDER]: ProviderKind;
  [STORAGE_KEYS.QWEN_CONFIG]: QwenConfig;
  [STORAGE_KEYS.CHAT_SETTINGS]: ChatSettings;
}
