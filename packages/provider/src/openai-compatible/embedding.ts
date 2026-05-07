/**
 * OpenAICompatibleEmbeddingProvider · OpenAI 兼容 /embeddings 基类
 * ---------------------------------------------
 * (v0.6.0-beta.2 抽离；原逻辑来自 `packages/provider/src/qwen/embedding.ts`)
 *
 * 协议：OpenAI 兼容的 `/embeddings` 端点
 *   POST {baseURL}/embeddings
 *   body: { model, input: string | string[], encoding_format: 'float' }
 *   resp: { data: [{ index, embedding: number[] }, ...], usage: {...} }
 *
 * 不用 `@ai-sdk/openai` 的 embedding API：
 * - embedding 协议足够简单（单次 fetch），自写更稳定、不受 SDK 版本变动影响
 * - 与 chat 的流式协议解耦
 *
 * 子类需实现：
 * - 选择合适的 `maxBatchSize` / `maxInputTokens`（千问硬限 25 / DeepSeek 官方无 embedding）
 */
import { createLogger, maskSecret, ProviderError } from '@doc-assistant/shared';
import { z } from 'zod';
import type { EmbeddingProvider, EmbeddingInfo } from '../embedding-interface';
import { joinUrl, safeReadText } from './config';

export interface OpenAICompatibleEmbeddingParams {
  apiKey: string;
  baseURL: string;
  model: string;
  dimension: number;
}

export interface OpenAICompatibleEmbeddingOptions {
  /** 日志 namespace */
  logName: string;
  /** 单次请求最大 batch（不同端点上限不同；千问=25，OpenAI=2048） */
  maxBatchSize: number;
  /** 单条最长 token 数（仅做 info 展示） */
  maxInputTokens: number;
  /** 非 2xx 时抛出的 ProviderError code（默认 EMBEDDING_HTTP_ERROR，Qwen 历史兼容） */
  httpErrorCode?: string;
}

/** OpenAI 兼容 /embeddings 响应 schema */
const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int(),
      embedding: z.array(z.number()),
    }),
  ),
});

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  protected readonly config: OpenAICompatibleEmbeddingParams;
  protected readonly info: EmbeddingInfo;
  protected readonly logger: ReturnType<typeof createLogger>;
  protected readonly httpErrorCode: string;

  constructor(
    config: OpenAICompatibleEmbeddingParams,
    opts: OpenAICompatibleEmbeddingOptions,
  ) {
    this.config = config;
    this.logger = createLogger(opts.logName);
    this.httpErrorCode = opts.httpErrorCode ?? 'EMBEDDING_HTTP_ERROR';
    this.info = {
      id: config.model,
      dimension: config.dimension,
      maxBatchSize: opts.maxBatchSize,
      maxInputTokens: opts.maxInputTokens,
    };
    this.logger.info(`${opts.logName} 初始化完成`, {
      baseURL: config.baseURL,
      model: config.model,
      dimension: config.dimension,
      apiKey: maskSecret(config.apiKey),
    });
  }

  getEmbeddingInfo(): EmbeddingInfo {
    return { ...this.info };
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (!texts.length) return [];

    const batchSize = this.info.maxBatchSize;
    const results: Float32Array[] = new Array(texts.length);
    const started = Date.now();
    let batches = 0;

    try {
      for (let start = 0; start < texts.length; start += batchSize) {
        const batch = texts.slice(start, start + batchSize);
        const vectors = await this.embedBatch(batch, signal);
        for (let i = 0; i < vectors.length; i++) {
          results[start + i] = vectors[i]!;
        }
        batches += 1;
      }
      this.logger.info('embedding call ok', {
        model: this.config.model,
        count: texts.length,
        batches,
        elapsedMs: Date.now() - started,
      });
      return results;
    } catch (err) {
      this.logger.error('embedding call failed', {
        model: this.config.model,
        count: texts.length,
        batches,
        elapsedMs: Date.now() - started,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  /** 子类可覆盖以加特化；默认实现跑 OpenAI 兼容 /embeddings */
  protected async embedBatch(batch: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const url = joinUrl(this.config.baseURL, '/embeddings');

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
        this.httpErrorCode,
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

    const sorted = [...parsed.data.data].sort((a, b) => a.index - b.index);
    if (sorted.length !== batch.length) {
      throw new ProviderError(
        'EMBEDDING_COUNT_MISMATCH',
        `请求 ${batch.length} 条文本但返回 ${sorted.length} 个向量`,
      );
    }

    return sorted.map((item) => {
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
}
