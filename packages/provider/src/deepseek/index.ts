/**
 * DeepSeekProvider · DeepSeek 大模型适配
 * ---------------------------------------------
 * v0.6.0-beta.2 新增。继承 `OpenAICompatibleProvider`，DeepSeek 端点 `https://api.deepseek.com`
 * 在 chat / tools / reasoning / usage 四条路径上完全兼容 OpenAI 协议。
 *
 * 特化：
 * - `getModelInfo()` 按 DEEPSEEK_MODEL_CAPABILITIES 表填充（当前覆盖 `deepseek-v4-flash`
 *   与 `deepseek-v4-pro`；未命中走保守 DEFAULT）
 * - `getProviderOptions()` 把统一的 `thinking: boolean` 翻译为请求体顶层
 *   `thinking: { type: 'enabled' | 'disabled' }`（DeepSeek 官方 API 规范，与
 *   `/chat/completions` 的 `model` / `messages` 同级；详见
 *   https://api-docs.deepseek.com/api/create-chat-completion ）。
 *   通过 `@ai-sdk/openai` 的 `providerOptions.openai` 路径由 AI SDK 作为扩展字段发出；
 *   enabled/disabled 两种都显式透传（DeepSeek 关闭思考需要显式 `disabled`，与 Qwen 不同）。
 *   若上游自发返回 `reasoning_content`，AI SDK 会将其识别为 reasoning part →
 *   normalizer 走 `reasoning-delta` 分支。
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
      // DeepSeek 当前线上模型（v4-flash / v4-pro）均未声明 reasoning 能力；
      // 若上游真吐 reasoning_content，normalizer 仍会归一化，但不在 ModelInfo 里乐观声明。
      supportsReasoning: cap.supportsReasoning,
      supportsTools: cap.supportsTools,
    };
  }

  /**
   * DeepSeek 特化：把统一的 `thinking: boolean` 翻译为 `providerOptions.openai.thinking
   * = { type: 'enabled' | 'disabled' }`，最终以请求体顶层 `thinking: { type }`
   * 发给 `/chat/completions`。（AI SDK v4 的 `@ai-sdk/openai` 会把
   * `providerOptions.openai` 的键合并进请求体。）enabled/disabled 两种都显式透传。
   */
  protected override getProviderOptions(
    _params: ChatParams,
  ): Record<string, unknown> | undefined {
    const type = this.deepSeekConfig.thinking ? 'enabled' : 'disabled';
    return {
      openai: {
        thinking: { type },
      },
    };
  }
}
