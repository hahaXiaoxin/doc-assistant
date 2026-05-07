/**
 * DeepSeekProvider · DeepSeek 大模型适配
 * ---------------------------------------------
 * v0.6.0-beta.2 新增。继承 `OpenAICompatibleProvider`，DeepSeek 端点 `https://api.deepseek.com`
 * 在 chat / tools / reasoning / usage 四条路径上完全兼容 OpenAI 协议。
 *
 * 特化：
 * - `getModelInfo()` 按 DEEPSEEK_MODEL_CAPABILITIES 表填充（当前覆盖 `deepseek-v4-flash`
 *   与 `deepseek-v4-pro`；未命中走保守 DEFAULT）
 * - `getProviderOptions()` 默认返回 undefined：DeepSeek 新模型不再区分"思考/非思考"
 *   显式透传；若上游自发返回 `reasoning_content`，AI SDK 会将其识别为 reasoning part →
 *   normalizer 走 `reasoning-delta` 分支。`enableThinking` 仅作 UI 层面的展示偏好，不改 payload。
 */
import { ProviderError } from '@doc-assistant/shared';
import type { ModelInfo } from '../interface';
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
      enableThinking: this.deepSeekConfig.enableThinking ?? false,
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
}
