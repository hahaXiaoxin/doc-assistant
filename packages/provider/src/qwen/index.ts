/**
 * QwenProvider · 千问大模型适配
 * ---------------------------------------------
 * v0.6.0-beta.2：已瘦身为 `OpenAICompatibleProvider` 基类的子类。思考模式对外
 * 统一为 `thinking: boolean`，Qwen 子类在 `getProviderOptions()` 里把它翻译为
 * 千问官方要求的 `extra_body.enable_thinking` 形态；`thinking=false` 时 early
 * return `undefined`，避免给 Qwen 发没必要的 `enable_thinking: false` 字段。
 *
 * 千问在 OpenAI 兼容模式下通过请求体 extra_body 接收 `enable_thinking`；AI SDK v4 的
 * OpenAI provider 提供 providerOptions 映射到 extra_body。
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
   * 千问特化：把统一的 `thinking: boolean` 翻译为 Qwen 官方要求的
   * `extra_body.enable_thinking`，透传给 AI SDK 的 `providerOptions.openai`。
   * `thinking=false` 时不透传（避免给 Qwen 发没必要的 `enable_thinking: false`）。
   */
  protected override getProviderOptions(_params: ChatParams): Record<string, unknown> | undefined {
    if (!this.qwenConfig.thinking) return undefined;
    return {
      openai: {
        enable_thinking: true,
      },
    };
  }
}
