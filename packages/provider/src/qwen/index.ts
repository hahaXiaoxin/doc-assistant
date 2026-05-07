/**
 * QwenProvider · 千问大模型适配
 * ---------------------------------------------
 * v0.6.0-beta.2：已瘦身为 `OpenAICompatibleProvider` 基类的子类，仅保留千问特化：
 * - `enable_thinking` 通过 `providerOptions.openai.extra_body` 透传
 * - `getModelInfo()` 根据 QWEN_MODEL_CAPABILITIES 表 + 用户 enableThinking 开关合成
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
      enableThinking: this.qwenConfig.enableThinking,
    });
  }

  getModelInfo(): ModelInfo {
    const cap = getQwenCapability(this.qwenConfig.model);
    return {
      id: this.qwenConfig.model,
      contextWindow: cap.contextWindow,
      supportsReasoning: cap.supportsReasoning && this.qwenConfig.enableThinking,
      supportsTools: cap.supportsTools,
    };
  }

  /** 千问特化：把 enable_thinking 通过 providerOptions.openai 透传为 extra_body */
  protected override getProviderOptions(_params: ChatParams): Record<string, unknown> | undefined {
    if (!this.qwenConfig.enableThinking) return undefined;
    return {
      openai: {
        enable_thinking: true,
      },
    };
  }
}
