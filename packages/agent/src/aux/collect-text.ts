/**
 * collectText · 把 LLMProvider.chat 流消费成纯文本
 * ---------------------------------------------
 * 用于辅助 LLM 的非交互式调用（SessionTopic 识别 / Intent 精判 / 反思抽取 等）：
 * - 这些场景不需要 tool-calling、不需要流式 UI，只要一段完整文本结果。
 * - 复用 Provider 的 `chat()` 流式 AsyncIterable 契约，避免在 LLMProvider 上追加非流式方法。
 *
 * 行为：
 * - 累加 `text-delta.delta`；忽略 `reasoning-delta`（思考过程不计入结果）。
 * - 忽略 `tool-call` / `tool-result`（辅 LLM 调用不传 tools，收到就直接丢弃以防意外）。
 * - 收到 `error` chunk → 立即抛 Provider/Abort 错误。
 * - 收到 `finish` → 结束。`finishReason='abort'` 抛 AbortError。
 * - 若外部 `signal` 在迭代中变为 aborted → 抛 AbortError。
 *
 * 错误语义（供调用方 catch）：
 * - `AbortError` (code='ABORTED')：用户/上层中断。
 * - `ProviderError` (code='NETWORK_ERROR' 等)：透传 Provider 层错误。
 * - `AgentError` (code='AUX_EMPTY_RESPONSE')：Provider 成功 finish 但没产出任何文本。
 */
import {
  AbortError,
  AgentError,
  ProviderError,
  createLogger,
  type ChatChunk,
} from '@doc-assistant/shared';

const logger = createLogger('agent:aux:collect-text');

export interface CollectTextOptions {
  /** 超出此字符数立即中止流（防御：某些模型忽略指令无限生成） */
  maxChars?: number;
  /** 调试标签，仅用于日志 */
  label?: string;
  /** 外部传入的 AbortSignal，用于中断检测 */
  signal?: AbortSignal;
}

export async function collectText(
  stream: AsyncIterable<ChatChunk>,
  opts: CollectTextOptions = {},
): Promise<string> {
  const { maxChars = 8_000, label = 'aux', signal } = opts;
  let buffer = '';
  let finished = false;

  try {
    for await (const chunk of stream) {
      if (signal?.aborted) {
        throw new AbortError('aux stream aborted');
      }
      switch (chunk.type) {
        case 'text-delta':
          buffer += chunk.delta;
          if (buffer.length >= maxChars) {
            logger.warn(`[${label}] 达到 maxChars 上限 (${maxChars})，主动截断`);
            finished = true;
          }
          break;
        case 'reasoning-delta':
          // aux 场景不需要思考链
          break;
        case 'tool-call':
        case 'tool-result':
          logger.warn(`[${label}] 意外收到 ${chunk.type}；aux 不应传 tools，忽略`);
          break;
        case 'finish':
          if (chunk.finishReason === 'abort') {
            throw new AbortError(`aux stream aborted (reason=abort)`);
          }
          if (chunk.finishReason === 'error') {
            throw new ProviderError(
              'NETWORK_ERROR',
              `aux stream finish with error (label=${label})`,
            );
          }
          finished = true;
          break;
        case 'error':
          throw chunk.error;
        default:
          // 穷尽性检查：未知 chunk 类型忽略
          break;
      }
      if (finished) break;
    }
  } catch (err) {
    if (err instanceof AbortError || err instanceof ProviderError || err instanceof AgentError) {
      throw err;
    }
    // 原生 AbortError（DOMException 形态）或 Error.name='AbortError'
    if ((err as Error)?.name === 'AbortError') {
      throw new AbortError((err as Error).message || 'aux aborted');
    }
    throw new ProviderError(
      'NETWORK_ERROR',
      `aux stream failure: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const result = buffer.trim();
  if (!finished) {
    // 流提前终止（没有 finish chunk）——按空响应处理
    logger.warn(`[${label}] 流在无 finish 情况下结束`);
  }
  if (!result) {
    throw new AgentError('AUX_EMPTY_RESPONSE', `aux stream 未产出文本 (label=${label})`);
  }
  return result;
}
