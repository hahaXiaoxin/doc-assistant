/**
 * DeepSeek Provider 配置 schema + 模型能力表
 * ---------------------------------------------
 * v0.6.0-beta.2 新增。DeepSeek 兼容 OpenAI 协议，接口形态与 Qwen 对齐。
 *
 * 模型（截至 2026-05-07 官方线上列表，旧 `deepseek-chat` / `deepseek-reasoner` /
 *  `deepseek-coder` 等已全部下线）：
 * - `deepseek-v4-flash`：低成本快响应档
 * - `deepseek-v4-pro`  ：高质量主档（若上游返回 `reasoning_content` 仍会经
 *   `normalizeStreamPart` 走 `reasoning-delta` 分支——非强绑定模型）
 *
 * 能力表里两档均未标 `supportsReasoning=true`：官方 `/models` 响应不再带
 *  reasoning 标识字段，本地不做乐观假设；但 normalizer 的 reasoning-delta 链路保留，
 *  上游若吐 reasoning 依旧能正确归一化。
 */
import { z } from 'zod';
import { openAICompatibleBaseConfigSchema } from '../openai-compatible/config';

/**
 * DeepSeek 配置 schema
 * - `enableThinking` 仅作为用户意图信号（UI 开关），运行时不透传 extra_body；
 *   DeepSeek 新模型不再区分"思考/非思考"路径，是否输出 reasoning 字段由模型自行决定。
 */
export const deepSeekProviderConfigSchema = openAICompatibleBaseConfigSchema.extend({
  enableThinking: z.boolean().optional(),
});

export type DeepSeekProviderConfig = z.infer<typeof deepSeekProviderConfigSchema>;

export interface DeepSeekModelCapability {
  contextWindow: number;
  /**
   * 官方声明的单次请求最大输出 token 数上限（可选）
   * ---------------------------------------------
   * DeepSeek v4 档两款模型均声明 384K（384,000）的最大输出能力。
   * 仅作为"能力声明"供上层参考，不改运行时默认 `max_tokens` —— 后者仍由 Provider /
   * Agent 层保守决定（避免单次请求把配额打爆）。未设置时表示未知。
   */
  maxOutputTokens?: number;
  supportsReasoning: boolean;
  supportsTools: boolean;
}

/**
 * DeepSeek 内置模型能力表（以官方最新文档为准；未命中时走 DEFAULT）
 *
 * 规格（2026-05-07 官方文档）：
 * - 上下文窗口：1,000,000 tokens（1M）
 * - 单次最大输出：384,000 tokens（384K）
 * 这里登记的是**能力上限**，运行时默认 `max_tokens` 仍由上层保守决定。
 */
export const DEEPSEEK_MODEL_CAPABILITIES: Record<string, DeepSeekModelCapability> = {
  'deepseek-v4-flash': {
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    supportsReasoning: false,
    supportsTools: true,
  },
  'deepseek-v4-pro': {
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    // 新模型官方未再暴露"reasoning 模式"标识；保守置 false。
    // normalizer 仍保留 reasoning-delta 分支，若上游返回 reasoning_content 会照常归一化。
    supportsReasoning: false,
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
export const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const;
// eslint-disable-next-line @typescript-eslint/ban-types
export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number] | (string & {});
