/**
 * QwenProvider · 千问大模型适配
 * ---------------------------------------------
 * v0.6.0-beta.2:
 * - chat 链路从 AI SDK 切到自己解析 OpenAI SSE(详见 openai-compatible/sse-chat.ts)
 * - 思考模式字段直接合并进请求体的 `extra_body`(Qwen/vLLM 风格的二级容器)
 *
 * 思考模式对外统一为 `thinking: boolean`,Qwen 子类在 `getRequestBodyExtras()` 里把它
 * 翻译为千问官方要求的 `extra_body.enable_thinking` 形态;`thinking=false` 时 early
 * return `undefined`,避免给 Qwen 发没必要的 `enable_thinking: false` 字段。
 */
import { ProviderError } from '@doc-assistant/shared';
import type { ChatParams, ModelInfo } from '../interface';
import { OpenAICompatibleProvider } from '../openai-compatible/provider';
import {
  getQwenCapability,
  qwenProviderConfigSchema,
  type QwenProviderConfig,
} from './config';

export class QwenProvider extends OpenAICompatibleProvider {
  private readonly qwenConfig: QwenProviderConfig;

  constructor(config: QwenProviderConfig) {
    const parsed = qwenProviderConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new ProviderError(
        'INVALID_CONFIG',
        `Qwen 配置不合法：${parsed.error.errors.map((e) => e.message).join('; ')}`,
      );
    }
    super(
      {
        apiKey: parsed.data.apiKey,
        baseURL: parsed.data.baseURL,
        model: parsed.data.model,
      },
      { logName: 'provider:qwen' },
    );
    this.qwenConfig = parsed.data;
    this.logger.info('QwenProvider 初始化特化', {
      thinking: this.qwenConfig.thinking,
    });
  }

  getModelInfo(): ModelInfo {
    const cap = getQwenCapability(this.qwenConfig.model);
    return {
      id: this.qwenConfig.model,
      contextWindow: cap.contextWindow,
      supportsReasoning: cap.supportsReasoning && this.qwenConfig.thinking,
      supportsTools: cap.supportsTools,
    };
  }

  /**
   * 千问特化:把统一的 `thinking: boolean` 翻译为 Qwen 官方要求的
   * `extra_body.enable_thinking`,直接合并入 chat completions 请求体。
   * `thinking=false` 时不透传(避免给 Qwen 发没必要的 `enable_thinking: false`)。
   */
  protected override getRequestBodyExtras(
    _params: ChatParams,
  ): Record<string, unknown> | undefined {
    if (!this.qwenConfig.thinking) return undefined;
    return { extra_body: { enable_thinking: true } };
  }
}
