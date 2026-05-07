/**
 * OpenAI 兼容端点的 HTTP 错误归一化
 * ---------------------------------------------
 * 把 401 / 403 / 404 / 429 / 5xx 映射到统一的 ProviderError code，
 * 供各家 OpenAI 兼容 Provider（Qwen / DeepSeek / 未来的 OpenAI / Moonshot）复用。
 *
 * 历史兼容：
 * - Qwen 之前抛的 `EMBEDDING_HTTP_ERROR` / `LIST_MODELS_HTTP_ERROR` 等专用 code
 *   仍然保留在调用方（见 embedding.ts / list-models.ts），以免破坏外部依赖；
 *   本文件的 `mapHttpErrorToProviderError` 只在**新**的共享逻辑中使用。
 */
import { ProviderError } from '@doc-assistant/shared';

/**
 * 把 OpenAI 兼容端点的 HTTP 非 2xx 响应映射到 ProviderError。
 *
 * @param status HTTP 状态码
 * @param bodyText 响应体（可能为空；本函数截断到 200 字符防爆日志）
 * @param context 可选前缀（如 "chat request" / "embeddings request"），出现在 message 开头
 */
export function mapHttpErrorToProviderError(
  status: number,
  bodyText: string,
  context?: string,
): ProviderError {
  const prefix = context ? `${context} ` : '';
  const snippet = (bodyText ?? '').slice(0, 200);
  if (status === 401 || status === 403) {
    return new ProviderError('AUTH_ERROR', `${prefix}鉴权失败(${status})：${snippet}`);
  }
  if (status === 404) {
    return new ProviderError('MODEL_NOT_FOUND', `${prefix}模型/端点不存在(${status})：${snippet}`);
  }
  if (status === 429) {
    return new ProviderError('RATE_LIMITED', `${prefix}触发限流(${status})：${snippet}`);
  }
  if (status >= 500) {
    return new ProviderError('UPSTREAM_ERROR', `${prefix}上游错误(${status})：${snippet}`);
  }
  return new ProviderError('PROVIDER_HTTP_ERROR', `${prefix}请求失败(${status})：${snippet}`);
}

/**
 * 把底层 fetch 抛的异常映射到 ProviderError。
 * - AbortError → ABORTED
 * - 其它 → NETWORK_ERROR
 */
export function mapFetchErrorToProviderError(err: unknown, context?: string): ProviderError {
  const prefix = context ? `${context} ` : '';
  const e = err as Error;
  if (e?.name === 'AbortError') {
    return new ProviderError('ABORTED', `${prefix}已取消`, { cause: err });
  }
  return new ProviderError('NETWORK_ERROR', `${prefix}网络错误：${e?.message ?? String(err)}`, {
    cause: err,
  });
}
