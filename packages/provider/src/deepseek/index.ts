/**
 * DeepSeekProvider · DeepSeek 大模型适配
 * ---------------------------------------------
 * v0.6.0-beta.2:
 * - chat 链路从 AI SDK 切到自己解析 OpenAI SSE(详见 openai-compatible/sse-chat.ts)
 * - 思考模式字段直接合并进请求体顶层(以前通过 AI SDK providerOptions 间接透传,
 *   v1.x AI SDK 会按白名单序列化把 `thinking` 吞掉,导致开关失效)
 *
 * 端点 `https://api.deepseek.com` 在 chat / tools / reasoning / usage 四条路径上
 * 完全兼容 OpenAI 协议。特化:
 * - `getModelInfo()` 按 DEEPSEEK_MODEL_CAPABILITIES 表填充
 * - `getRequestBodyExtras()` 把统一的 `thinking: boolean` 翻译为请求体顶层
 *   `thinking: { type: 'enabled' | 'disabled' }`(DeepSeek 官方 API 规范,
 *   与 `model`/`messages` 同级;详见 https://api-docs.deepseek.com/api/create-chat-completion)。
 *   enabled/disabled 两种都显式透传(DeepSeek 关闭思考需要显式 `disabled`,与 Qwen 不同)。
 */
import { ProviderError } from '@doc-assistant/shared';
import type { ChatParams, ModelInfo } from '../interface';
import { OpenAICompatibleProvider } from '../openai-compatible/provider';
import {
  deepSeekProviderConfigSchema,
  getDeepSeekCapability,
  type DeepSeekProviderConfig,
} from './config';

export class DeepSeekProvider extends OpenAICompatibleProvider {
  private readonly deepSeekConfig: DeepSeekProviderConfig;

  constructor(config: DeepSeekProviderConfig) {
    const parsed = deepSeekProviderConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new ProviderError(
        'INVALID_CONFIG',
        `DeepSeek 配置不合法：${parsed.error.errors.map((e) => e.message).join('; ')}`,
      );
    }
    super(
      {
        apiKey: parsed.data.apiKey,
        baseURL: parsed.data.baseURL,
        model: parsed.data.model,
      },
      { logName: 'provider:deepseek' },
    );
    this.deepSeekConfig = parsed.data;
    this.logger.info('DeepSeekProvider 初始化特化', {
      model: this.deepSeekConfig.model,
      thinking: this.deepSeekConfig.thinking,
    });
  }

  getModelInfo(): ModelInfo {
    const cap = getDeepSeekCapability(this.deepSeekConfig.model);
    return {
      id: this.deepSeekConfig.model,
      contextWindow: cap.contextWindow,
      ...(typeof cap.maxOutputTokens === 'number'
        ? { maxOutputTokens: cap.maxOutputTokens }
        : {}),
      supportsReasoning: cap.supportsReasoning,
      supportsTools: cap.supportsTools,
    };
  }

  /**
   * DeepSeek 特化:把统一的 `thinking: boolean` 翻译为请求体顶层
   * `thinking: { type: 'enabled' | 'disabled' }`,直接合并入 chat completions 请求体。
   * enabled/disabled 两种都显式透传(关闭思考需要显式 `disabled`,与 Qwen 不同)。
   */
  protected override getRequestBodyExtras(
    _params: ChatParams,
  ): Record<string, unknown> | undefined {
    const type = this.deepSeekConfig.thinking ? 'enabled' : 'disabled';
    return { thinking: { type } };
  }
}
