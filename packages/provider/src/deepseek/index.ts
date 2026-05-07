/**
 * DeepSeekProvider · DeepSeek 大模型适配
 * ---------------------------------------------
 * v0.6.0-beta.2 新增。继承 `OpenAICompatibleProvider`，DeepSeek 端点 `https://api.deepseek.com`
 * 在 chat / tools / reasoning / usage 四条路径上完全兼容 OpenAI 协议。
 *
 * 特化：
 * - `getModelInfo()` 按 DEEPSEEK_MODEL_CAPABILITIES 表填充；reasoner 的 supportsReasoning
 *   始终为 true（enableThinking 仅作用户意图信号，不改变能力）
 * - `getProviderOptions()` 默认返回 undefined：DeepSeek 不需要像 Qwen 那样显式透传
 *   enable_thinking；reasoner 的思考能力由模型本身决定，`reasoning_content` 由
 *   AI SDK 自动识别为 reasoning part → normalizer 走 `reasoning-delta` 分支
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
      // DeepSeek-R1 的思考能力由模型绑定；enableThinking 只作 UI 层面的"是否展示折叠思维链"语义提示
      supportsReasoning: cap.supportsReasoning,
      supportsTools: cap.supportsTools,
    };
  }
}
