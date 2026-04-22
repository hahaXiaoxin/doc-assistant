/**
 * QwenEmbeddingProvider · 千问 DashScope Embedding 实现
 * ---------------------------------------------
 * v0.2 · 记忆层向量召回的默认 embedding 实现
 *
 * 协议：OpenAI 兼容的 /embeddings 端点
 *   POST {baseURL}/embeddings
 *   body: { model, input: string | string[], encoding_format: 'float' }
 *   resp: { data: [{ index, embedding: number[] }, ...], usage: {...} }
 *
 * 约束：
 * - 单次请求 input 数量 ≤ 25（千问限制，超出自动分批）
 * - 单条 input ≤ 2048 token（调用方负责 trim，本类不重复做）
 * - 维度与模型绑定：v2=1536, v3=1024；换模型必须清向量库重建索引
 *
 * 不使用 @ai-sdk/openai 的 embedding API：
 * - embedding 协议足够简单（单次 fetch），自写更稳定、不受 SDK 版本变动影响
 * - 与 chat 的流式协议解耦，复用 maskSecret + ProviderError 约定
 */

import { createLogger, maskSecret, ProviderError } from '@doc-assistant/shared';
import { z } from 'zod';
import type { EmbeddingProvider, EmbeddingInfo } from '../embedding-interface';

const logger = createLogger('provider:qwen-embedding');

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
const DEFAULT_MAX_BATCH = 25;

/**
 * OpenAI 兼容 /embeddings 响应的结构化校验
 * 注：千问的 DashScope OpenAI 兼容端点返回与 OpenAI 一致
 */
const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int(),
      embedding: z.array(z.number()),
    }),
  ),
});

export class QwenEmbeddingProvider implements EmbeddingProvider {
  private readonly config: QwenEmbeddingProviderConfig;
  private readonly info: EmbeddingInfo;

  constructor(rawConfig: unknown) {
    const parsed = qwenEmbeddingConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      throw new ProviderError(
        'INVALID_CONFIG',
        `QwenEmbeddingProvider 配置非法：${parsed.error.message}`,
      );
    }
    this.config = parsed.data;

    const capability = CAPABILITY_TABLE[this.config.model] ?? {
      dimension: this.config.dimension,
      maxInputTokens: 2048,
    };
    this.info = {
      id: this.config.model,
      dimension: capability.dimension,
      maxBatchSize: DEFAULT_MAX_BATCH,
      maxInputTokens: capability.maxInputTokens,
    };

    logger.info('QwenEmbeddingProvider 初始化完成', {
      baseURL: this.config.baseURL,
      model: this.config.model,
      dimension: this.info.dimension,
      apiKey: maskSecret(this.config.apiKey),
    });

    // 配置声明的维度与能力表不一致时给出警告（不阻塞，因为用户可能用自定义模型）
    if (CAPABILITY_TABLE[this.config.model] && this.config.dimension !== capability.dimension) {
      logger.warn(
        `配置的 dimension(${this.config.dimension}) 与模型 ${this.config.model} 实际维度(${capability.dimension}) 不一致，使用实际维度`,
      );
    }
  }

  getEmbeddingInfo(): EmbeddingInfo {
    return { ...this.info };
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (!texts.length) return [];

    const batchSize = this.info.maxBatchSize;
    const results: Float32Array[] = new Array(texts.length);

    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize);
      const vectors = await this.embedBatch(batch, signal);
      for (let i = 0; i < vectors.length; i++) {
        results[start + i] = vectors[i]!;
      }
    }

    return results;
  }

  /**
   * 对单批（≤ maxBatchSize 条）文本做 embedding
   * @internal 暴露为 protected 便于测试覆盖，不作为公共 API
   */
  protected async embedBatch(batch: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const url = this.joinUrl(this.config.baseURL, '/embeddings');

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          input: batch,
          encoding_format: 'float',
        }),
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      // 网络错误 / AbortError / DNS 等
      if ((err as Error).name === 'AbortError') {
        throw new ProviderError('ABORTED', '用户中断 embedding 请求', { cause: err });
      }
      throw new ProviderError(
        'NETWORK_ERROR',
        `embedding 请求失败：${(err as Error).message}`,
        { cause: err },
      );
    }

    if (!response.ok) {
      const body = await safeReadText(response);
      throw new ProviderError(
        'EMBEDDING_HTTP_ERROR',
        `embedding 请求返回 ${response.status}：${body.slice(0, 200)}`,
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new ProviderError(
        'EMBEDDING_PARSE_ERROR',
        `embedding 响应非合法 JSON：${(err as Error).message}`,
        { cause: err },
      );
    }

    const parsed = embeddingResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError(
        'EMBEDDING_SCHEMA_ERROR',
        `embedding 响应结构非法：${parsed.error.message}`,
      );
    }

    // 按 index 排序后转 Float32Array
    const sorted = [...parsed.data.data].sort((a, b) => a.index - b.index);
    if (sorted.length !== batch.length) {
      throw new ProviderError(
        'EMBEDDING_COUNT_MISMATCH',
        `请求 ${batch.length} 条文本但返回 ${sorted.length} 个向量`,
      );
    }

    return sorted.map((item) => {
      // 同时校验维度一致性（防模型切换后旧向量乱用）
      const vec = item.embedding;
      if (vec.length !== this.info.dimension) {
        throw new ProviderError(
          'EMBEDDING_DIMENSION_MISMATCH',
          `返回向量维度 ${vec.length} 与声明维度 ${this.info.dimension} 不一致`,
        );
      }
      return Float32Array.from(vec);
    });
  }

  private joinUrl(baseURL: string, path: string): string {
    const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
  }
}

async function safeReadText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}
