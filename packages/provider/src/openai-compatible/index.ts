/**
 * @doc-assistant/provider · openai-compatible
 * ---------------------------------------------
 * OpenAI 兼容协议 Provider 的共享基类与工具：
 * - `OpenAICompatibleProvider`：chat 流式 + tool calling + CoreMessage 转换
 * - `OpenAICompatibleEmbeddingProvider`：/embeddings 分批 + 维度校验
 * - `listOpenAICompatibleModels`：/models 骨架（分类由调用方注入）
 * - `normalizeStreamPart`：AI SDK → ChatChunk 归一化
 * - `jsonSchemaToZod`：tool 参数 schema 转换
 * - `mapHttpErrorToProviderError` / `mapFetchErrorToProviderError`：错误归一化
 * - `joinUrl` / `safeReadText` / `safeParseJSON` / `openAICompatibleBaseConfigSchema`：共享工具
 */
export {
  OpenAICompatibleProvider,
  jsonSchemaToZod,
  type OpenAICompatibleBaseParams,
  type OpenAICompatibleProviderOptions,
} from './provider';
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
export { normalizeStreamPart, type UnknownStreamPart } from './normalizer';
export {
  mapHttpErrorToProviderError,
  mapFetchErrorToProviderError,
} from './errors';
export {
  joinUrl,
  safeReadText,
  safeParseJSON,
  openAICompatibleBaseConfigSchema,
  type OpenAICompatibleBaseConfig,
} from './config';
