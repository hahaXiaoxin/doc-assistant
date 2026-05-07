/**
 * AI SDK stream part → ChatChunk 归一化
 * ---------------------------------------------
 * (原 `packages/provider/src/qwen/normalizer.ts`；v0.6.0-beta.2 迁入 openai-compatible
 *  基类目录，Qwen / DeepSeek / 未来其它 OpenAI 兼容 Provider 共享。)
 *
 * 目的：
 * - 屏蔽 AI SDK 版本漂移：AI SDK 的 `TextStreamPart` 联合类型会随版本变化，
 *   Agent 层不应直接依赖，故在此做转换。
 * - 处理千问 / DeepSeek 等 provider 的 `reasoning_content` 字段：AI SDK 在 reasoning
 *   支持的 provider 上会发出 'reasoning' 类型的 part，我们映射为
 *   `{ type: 'reasoning-delta', delta }`。
 *
 * 约束：
 * - 不做 best-effort 解析；看不懂的 part 原样忽略并通过 logger.debug 记录，保持 stream 不中断。
 * - finish 必须最后发出；error 发出后 stream 应立即结束。
 */
import type { ChatChunk, ToolCall, ToolResult } from '@doc-assistant/shared';
import { createLogger } from '@doc-assistant/shared';

const logger = createLogger('provider:openai-compatible:normalizer');

/**
 * AI SDK v4 的 stream part 形态（简化版，不直接 import AI SDK 类型以免绑死版本）
 * 兼容 AI SDK v4 常见 part：
 * - { type: 'text-delta', textDelta }
 * - { type: 'reasoning', textDelta } | { type: 'reasoning-delta' | 'reasoning-signature', ... }
 * - { type: 'tool-call', toolCallId, toolName, args }
 * - { type: 'tool-result', toolCallId, toolName, result, isError? }
 * - { type: 'finish', finishReason, usage }
 * - { type: 'error', error }
 */
export interface UnknownStreamPart {
  type: string;
  [key: string]: unknown;
}

/** 映射 AI SDK finishReason 到自己的联合 */
function normalizeFinishReason(raw: unknown): ChatChunk extends infer C
  ? C extends { type: 'finish'; finishReason: infer R }
    ? R
    : never
  : never {
  switch (raw) {
    case 'stop':
      return 'stop';
    case 'tool-calls':
    case 'tool_calls':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'content-filter':
    case 'content_filter':
      return 'content_filter';
    case 'abort':
    case 'aborted':
      return 'abort';
    case 'error':
      return 'error';
    default:
      return 'other';
  }
}

/**
 * 归一化单个 stream part → 0/1/N 个 ChatChunk
 */
export function normalizeStreamPart(part: UnknownStreamPart): ChatChunk[] {
  switch (part.type) {
    // 文本增量
    case 'text-delta': {
      const delta = typeof part.textDelta === 'string' ? part.textDelta : '';
      return delta ? [{ type: 'text-delta', delta }] : [];
    }

    // AI SDK v4 的 reasoning part（对应 qwen/deepseek-reasoner 的 reasoning_content）
    case 'reasoning':
    case 'reasoning-delta': {
      const delta = typeof part.textDelta === 'string' ? part.textDelta : '';
      return delta ? [{ type: 'reasoning-delta', delta }] : [];
    }

    // reasoning 签名等元信息忽略
    case 'reasoning-signature':
    case 'redacted-reasoning':
      return [];

    // Tool 调用
    case 'tool-call': {
      const call: ToolCall = {
        id: String(part.toolCallId ?? ''),
        name: String(part.toolName ?? ''),
        args: part.args,
      };
      if (!call.id || !call.name) {
        logger.warn('收到非法 tool-call part:', part);
        return [];
      }
      return [{ type: 'tool-call', call }];
    }

    // Tool 结果（streamText 在执行完 tool 后回灌时发出）
    case 'tool-result': {
      const result: ToolResult = {
        toolCallId: String(part.toolCallId ?? ''),
        name: String(part.toolName ?? ''),
        result: part.result,
        isError: Boolean(part.isError),
      };
      return [{ type: 'tool-result', result }];
    }

    case 'finish': {
      const usage = extractUsage(part.usage);
      return [
        {
          type: 'finish',
          finishReason: normalizeFinishReason(part.finishReason),
          ...(usage ? { usage } : {}),
        },
      ];
    }

    case 'error': {
      const err =
        part.error instanceof Error
          ? part.error
          : new Error(typeof part.error === 'string' ? part.error : 'Unknown stream error');
      return [{ type: 'error', error: err }];
    }

    // AI SDK 可能发出的其它元数据类 part（step-start/step-finish 等），对 Agent 不关心
    case 'step-start':
    case 'step-finish':
    case 'tool-call-streaming-start':
    case 'tool-call-delta':
      return [];

    default:
      logger.debug('忽略未知 stream part 类型:', part.type);
      return [];
  }
}

function extractUsage(
  raw: unknown,
): { promptTokens?: number; completionTokens?: number; reasoningTokens?: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
  } = {};
  if (typeof r.promptTokens === 'number') out.promptTokens = r.promptTokens;
  if (typeof r.completionTokens === 'number') out.completionTokens = r.completionTokens;
  if (typeof r.reasoningTokens === 'number') out.reasoningTokens = r.reasoningTokens;
  return Object.keys(out).length ? out : undefined;
}
