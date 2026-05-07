/**
 * DeepSeek Provider 配置 schema + 模型能力表
 * ---------------------------------------------
 * v0.6.0-beta.2 新增。DeepSeek 兼容 OpenAI 协议，接口形态与 Qwen 对齐。
 *
 * 模型亮点（截至 2026-05，基于官方文档）：
 * - `deepseek-chat`：DeepSeek-V3 非思考路径；64K 上下文；支持工具调用
 * - `deepseek-reasoner`：DeepSeek-R1 思考模型；64K 上下文；通过 `reasoning_content` 流出 CoT；
 *   官方文档明确其原生"思考模式"，`enableThinking` 开关对 reasoner 语义上等同于"勾选该模型"，
 *   所以 Provider 实现不需要额外透传 extra_body；由 AI SDK 自动识别 reasoning part。
 */
import { z } from 'zod';
import { openAICompatibleBaseConfigSchema } from '../openai-compatible/config';

/**
 * DeepSeek 配置 schema
 * - `enableThinking` 仅作为用户意图信号（UI 开关 + reasoner 搭配），运行时不需要透传 extra_body
 */
export const deepSeekProviderConfigSchema = openAICompatibleBaseConfigSchema.extend({
  enableThinking: z.boolean().optional(),
});

export type DeepSeekProviderConfig = z.infer<typeof deepSeekProviderConfigSchema>;

export interface DeepSeekModelCapability {
  contextWindow: number;
  supportsReasoning: boolean;
  supportsTools: boolean;
}

/** DeepSeek 内置模型能力表（以官方最新文档为准；未命中时走 DEFAULT） */
export const DEEPSEEK_MODEL_CAPABILITIES: Record<string, DeepSeekModelCapability> = {
  'deepseek-chat': {
    contextWindow: 65536,
    supportsReasoning: false,
    supportsTools: true,
  },
  'deepseek-reasoner': {
    contextWindow: 65536,
    supportsReasoning: true,
    supportsTools: true,
  },
};

/** 未命中能力表时的兜底（保守） */
export const DEEPSEEK_DEFAULT_CAPABILITY: DeepSeekModelCapability = {
  contextWindow: 32768,
  supportsReasoning: false,
  supportsTools: true,
};

export function getDeepSeekCapability(model: string): DeepSeekModelCapability {
  return DEEPSEEK_MODEL_CAPABILITIES[model] ?? DEEPSEEK_DEFAULT_CAPABILITY;
}

/** UI 推荐模型列表（下拉建议值，API 失败时的兜底） */
export const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner'] as const;
// eslint-disable-next-line @typescript-eslint/ban-types
export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number] | (string & {});
