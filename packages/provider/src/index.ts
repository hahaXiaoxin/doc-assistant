/**
 * @doc-assistant/provider · 入口
 * ---------------------------------------------
 * 职责：屏蔽各家 LLM 厂商协议差异，向 Agent 层暴露统一的 LLMProvider 接口。
 *
 * v0.2 新增：EmbeddingProvider 接口 + QwenEmbeddingProvider 实现，
 * 用于记忆层向量召回。embedding 与 chat 接口独立但配置可复用主 Provider。
 *
 * v0.6.0-beta.2：抽离 OpenAICompatibleProvider 基类 + 新增 DeepSeek Provider + Provider Registry。
 *
 * 架构约束：
 * - v0.6.0-beta.2 起 chat 链路改为裸 fetch + 自己解析 OpenAI SSE，不再依赖
 *   `ai` / `@ai-sdk/openai`(详见 sse-chat.ts 与 openai-compatible/provider.ts)。
 * - Agent 层严禁直接 import 协议层细节，必须通过 LLMProvider 接口使用（ESLint 强约束）。
 */

export type { LLMProvider, ChatParams, ModelInfo } from './interface';
export type { EmbeddingProvider, EmbeddingInfo } from './embedding-interface';

/* ---- OpenAI 兼容基类（v0.6.0-beta.2 抽离） ---- */
export {
  OpenAICompatibleProvider,
  OpenAICompatibleEmbeddingProvider,
  listOpenAICompatibleModels,
  runOpenAIChatStream,
  normalizeFinishReason,
  extractUsage,
  mapHttpErrorToProviderError,
  mapFetchErrorToProviderError,
  openAICompatibleBaseConfigSchema,
  joinUrl,
  safeReadText,
  type OpenAICompatibleBaseParams,
  type OpenAICompatibleProviderOptions,
  type OpenAICompatibleEmbeddingParams,
  type OpenAICompatibleEmbeddingOptions,
  type ListOpenAICompatibleModelsParams,
  type RawModelEntry,
  type OpenAIChatRequest,
  type OpenAIMessage,
  type OpenAITool,
  type OpenAICompatibleBaseConfig,
} from './openai-compatible/index';

/* ---- Qwen ---- */
export { QwenProvider } from './qwen/index';
export {
  qwenProviderConfigSchema,
  getQwenCapability,
  QWEN_MODEL_CAPABILITIES,
  QWEN_DEFAULT_CAPABILITY,
  type QwenProviderConfig,
  type QwenModelCapability,
} from './qwen/config';
export {
  QwenEmbeddingProvider,
  qwenEmbeddingConfigSchema,
  type QwenEmbeddingProviderConfig,
} from './qwen/embedding';
export {
  listQwenModels,
  classifyQwenModel,
  type QwenModelListItem,
  type QwenModelKind,
  type ListQwenModelsParams,
} from './qwen/list-models';

/* ---- DeepSeek (v0.6.0-beta.2) ---- */
export { DeepSeekProvider } from './deepseek/index';
export {
  deepSeekProviderConfigSchema,
  getDeepSeekCapability,
  DEEPSEEK_MODEL_CAPABILITIES,
  DEEPSEEK_DEFAULT_CAPABILITY,
  DEEPSEEK_MODELS,
  type DeepSeekProviderConfig,
  type DeepSeekModelCapability,
} from './deepseek/config';
export {
  listDeepSeekModels,
  classifyDeepSeekModel,
  type DeepSeekModelListItem,
  type DeepSeekModelKind,
  type ListDeepSeekModelsParams,
} from './deepseek/list-models';

/* ---- Provider Registry (v0.6.0-beta.2) ---- */
export {
  PROVIDER_REGISTRY,
  getProviderEntry,
  listProviderEntries,
  listEmbeddingCapableProviders,
  type ProviderRegistryEntry,
  type EmbeddingRegistryInfo,
  type GenericModelListItem,
  type GenericModelKind,
  type ListModelsFn,
  type LLMProviderFactory,
} from './registry';
