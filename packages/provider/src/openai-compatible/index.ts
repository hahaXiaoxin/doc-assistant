/**
 * @doc-assistant/provider · openai-compatible
 * ---------------------------------------------
 * OpenAI 兼容协议 Provider 的共享基类与工具：
 * - `OpenAICompatibleProvider`:chat 流式 + tool calling + OpenAI 协议消息转换
 * - `OpenAICompatibleEmbeddingProvider`:/embeddings 分批 + 维度校验
 * - `listOpenAICompatibleModels`:/models 骨架（分类由调用方注入）
 * - `runOpenAIChatStream`:裸 fetch + SSE 解析（v0.6.0-beta.2 起替代 AI SDK）
 * - `normalizeFinishReason` / `extractUsage`:OpenAI 协议响应字段归一化
 * - `mapHttpErrorToProviderError` / `mapFetchErrorToProviderError`:错误归一化
 * - `joinUrl` / `safeReadText` / `openAICompatibleBaseConfigSchema`:共享工具
 */
export {
  OpenAICompatibleProvider,
  type OpenAICompatibleBaseParams,
  type OpenAICompatibleProviderOptions,
} from './provider';
export {
  runOpenAIChatStream,
  normalizeFinishReason,
  extractUsage,
  type OpenAIChatRequest,
  type OpenAIMessage,
  type OpenAITool,
  type RunOpenAIChatStreamArgs,
} from './sse-chat';
export {
  OpenAICompatibleEmbeddingProvider,
  type OpenAICompatibleEmbeddingParams,
  type OpenAICompatibleEmbeddingOptions,
} from './embedding';
export {
  listOpenAICompatibleModels,
  type ListOpenAICompatibleModelsParams,
  type RawModelEntry,
} from './list-models';
export {
  mapHttpErrorToProviderError,
  mapFetchErrorToProviderError,
} from './errors';
export {
  joinUrl,
  safeReadText,
  openAICompatibleBaseConfigSchema,
  type OpenAICompatibleBaseConfig,
} from './config';
