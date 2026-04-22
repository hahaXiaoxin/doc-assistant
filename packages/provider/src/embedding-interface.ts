/**
 * EmbeddingProvider 接口
 * ---------------------------------------------
 * v0.2 · 为记忆层向量召回提供 embedding 抽象
 *
 * 职责：屏蔽不同厂商 embedding API 差异（千问 / 未来 OpenAI / 本地模型）。
 * 设计与 LLMProvider 并列但独立：
 * - chat 与 embedding 是不同协议（embedding 是非流式的批量请求），不应混用同一接口
 * - 配置层允许 embedding 复用主 LLMProvider 的 baseURL+apiKey（大多数 Provider 都在同一端点下提供两种能力）
 *
 * 所有实现必须：
 * - 约束单次请求的最大 batch（默认 25，千问限制）
 * - 维度由 `getEmbeddingInfo().dimension` 声明，调用方据此做向量库兼容性校验
 * - API Key 严禁日志输出（遵循 shared 的 maskSecret 规范）
 */

export interface EmbeddingInfo {
  /** 当前使用的 embedding 模型 id（如 text-embedding-v2） */
  id: string;
  /** 向量维度（v2=1536 / v3=1024）；更换模型时必须重建索引 */
  dimension: number;
  /** 单次请求最大文本数量 */
  maxBatchSize: number;
  /** 单条文本最大 token 数（上层可用它做 trim） */
  maxInputTokens: number;
}

export interface EmbeddingProvider {
  /**
   * 对一组文本生成向量。
   * @param texts 输入文本；调用方需确保每条不超过 `maxInputTokens`
   * @param signal 可选，用于取消请求
   * @returns 与 texts 一一对应的 Float32Array 向量；失败抛 ProviderError
   *
   * 实现约定：
   * - 调用方传入 `texts.length > maxBatchSize` 时，实现内部自动分批
   * - 空数组直接返回 []
   */
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;

  /** 当前 embedding 模型元信息 */
  getEmbeddingInfo(): EmbeddingInfo;
}
