/**
 * @doc-assistant/provider · 入口
 * ---------------------------------------------
 * 职责：屏蔽各家 LLM 厂商协议差异，向 Agent 层暴露统一的 LLMProvider 接口。
 *
 * v0.2 新增：EmbeddingProvider 接口 + QwenEmbeddingProvider 实现，
 * 用于记忆层向量召回。embedding 与 chat 接口独立但配置可复用主 Provider。
 *
 * 架构约束：
 * - 本包内部可以使用 Vercel AI SDK（`ai` / `@ai-sdk/*`）做协议适配。
 * - Agent 层严禁直接 import AI SDK，必须通过 LLMProvider 接口使用（ESLint 强约束）。
 */

export type { LLMProvider, ChatParams, ModelInfo } from './interface';
export type { EmbeddingProvider, EmbeddingInfo } from './embedding-interface';
export { QwenProvider } from './qwen/index';
export {
  qwenProviderConfigSchema,
  getQwenCapability,
  type QwenProviderConfig,
} from './qwen/config';
export { normalizeStreamPart, type UnknownStreamPart } from './qwen/normalizer';
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
