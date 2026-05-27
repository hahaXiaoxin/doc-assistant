/**
 * QwenEmbeddingProvider · 千问 DashScope Embedding 实现
 * ---------------------------------------------
 * v0.6.0-beta.2：瘦身为 `OpenAICompatibleEmbeddingProvider` 的子类。
 * 保留的千问特化：
 * - `CAPABILITY_TABLE` 填入 v2 / v3 的实际 dimension 与 maxInputTokens
 * - `maxBatchSize = 25`（千问硬限制）
 * - 构造期 zod 校验（向后兼容历史错误 code EMBEDDING_HTTP_ERROR）
 * - 声明维度与能力表不符时的"以能力表为准 + warn"行为
 */
import { ProviderError } from '@doc-assistant/shared';
import { z } from 'zod';
import { OpenAICompatibleEmbeddingProvider } from '../openai-compatible/embedding';

export const qwenEmbeddingConfigSchema = z.object({
  apiKey: z.string().min(1, 'apiKey 不能为空'),
  baseURL: z.string().url('baseURL 必须是合法 URL'),
  model: z.string().min(1, 'model 不能为空'),
  dimension: z.number().int().positive('dimension 必须为正整数'),
});

export type QwenEmbeddingProviderConfig = z.infer<typeof qwenEmbeddingConfigSchema>;

/** 千问 embedding 模型能力表 */
const CAPABILITY_TABLE: Record<string, { dimension: number; maxInputTokens: number }> = {
  'text-embedding-v2': { dimension: 1536, maxInputTokens: 2048 },
  'text-embedding-v3': { dimension: 1024, maxInputTokens: 8192 },
};

/** 单次请求的最大 batch（千问硬限制） */
const QWEN_MAX_BATCH = 25;

export class QwenEmbeddingProvider extends OpenAICompatibleEmbeddingProvider {
  constructor(rawConfig: unknown) {
    const parsed = qwenEmbeddingConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      throw new ProviderError(
        'INVALID_CONFIG',
        `QwenEmbeddingProvider 配置非法：${parsed.error.message}`,
      );
    }
    const cfg = parsed.data;
    const capability = CAPABILITY_TABLE[cfg.model] ?? {
      dimension: cfg.dimension,
      maxInputTokens: 2048,
    };

    super(
      {
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL,
        model: cfg.model,
        dimension: capability.dimension,
      },
      {
        logName: 'provider:qwen-embedding',
        maxBatchSize: QWEN_MAX_BATCH,
        maxInputTokens: capability.maxInputTokens,
        httpErrorCode: 'EMBEDDING_HTTP_ERROR',
      },
    );

    // 声明的维度与能力表不一致时给出警告（不阻塞，因为用户可能用自定义模型）
    if (CAPABILITY_TABLE[cfg.model] && cfg.dimension !== capability.dimension) {
      this.logger.warn(
        `配置的 dimension(${cfg.dimension}) 与模型 ${cfg.model} 实际维度(${capability.dimension}) 不一致，使用实际维度`,
      );
    }
  }
}
