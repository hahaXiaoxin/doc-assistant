/**
 * Qwen Provider 配置 schema
 * ---------------------------------------------
 * 这里的 schema 与 shared/config.ts 中的 LLMProviderConfig 对齐；本文件只负责 Provider
 * 运行时校验，不负责 UI 表单校验（表单校验在 ui/features/options）。
 *
 * 思考模式对外统一为 `thinking: boolean`，默认 `true`；Provider 内部翻译为
 * `extra_body.enable_thinking`（Qwen 官方形态）。
 */
import { z } from 'zod';
import { openAICompatibleBaseConfigSchema } from '../openai-compatible/config';

export const qwenProviderConfigSchema = openAICompatibleBaseConfigSchema.extend({
  thinking: z.boolean().default(true),
});

export type QwenProviderConfig = z.infer<typeof qwenProviderConfigSchema>;

/**
 * 千问各模型的粗略能力标注
 * ---------------------------------------------
 * 用于 getModelInfo()；实际上下文窗口以阿里云官方文档为准。
 * 这里的 contextWindow 为粗略经验值，Agent 侧做截断决策时会留余量。
 */
export interface QwenModelCapability {
  contextWindow: number;
  supportsReasoning: boolean;
  supportsTools: boolean;
}

export const QWEN_MODEL_CAPABILITIES: Record<string, QwenModelCapability> = {
  'qwen-plus': {
    contextWindow: 131072,
    supportsReasoning: true,
    supportsTools: true,
  },
  'qwen-max': {
    contextWindow: 32768,
    supportsReasoning: false,
    supportsTools: true,
  },
  'qwen-turbo': {
    contextWindow: 131072,
    supportsReasoning: false,
    supportsTools: true,
  },
  'qwen3-max': {
    contextWindow: 262144,
    supportsReasoning: true,
    supportsTools: true,
  },
};

/** 兜底能力：未知模型保守假设 */
export const QWEN_DEFAULT_CAPABILITY: QwenModelCapability = {
  contextWindow: 32768,
  supportsReasoning: false,
  supportsTools: true,
};

export function getQwenCapability(model: string): QwenModelCapability {
  return QWEN_MODEL_CAPABILITIES[model] ?? QWEN_DEFAULT_CAPABILITY;
}
