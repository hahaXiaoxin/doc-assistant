/**
 * QwenProvider · 千问大模型适配
 * ---------------------------------------------
 * v0.6.0-beta.2:
 * - chat 链路从 AI SDK 切到自己解析 OpenAI SSE(详见 openai-compatible/sse-chat.ts)
 * - 思考模式字段直接合并进请求体的 `extra_body`(Qwen/vLLM 风格的二级容器)
 * - 子类扩展从"override protected 方法"改为"在构造函数注册 hook"
 *
 * 思考模式对外统一为 `thinking: boolean`。Qwen 子类在构造函数里仅当 `thinking=true`
 * 时注册 `request:body` hook(`qwen:enable-thinking`),把开关翻译为千问官方要求的
 * `extra_body.enable_thinking=true` 形态;`thinking=false` 时不注册 hook,避免给
 * Qwen 发没必要的 `enable_thinking: false` 字段。
 */
import { ProviderError } from '@doc-assistant/shared';
import type { ModelInfo } from '../interface';
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

    // 思考模式(extra_body 容器)。Qwen 关闭思考时不发任何字段——直接不注册 hook。
    if (this.qwenConfig.thinking) {
      this.hooks.register({
        kind: 'request:body',
        name: 'qwen:enable-thinking',
        fn: (body) => ({
          ...body,
          extra_body: {
            ...((body.extra_body as Record<string, unknown> | undefined) ?? {}),
            enable_thinking: true,
          },
        }),
      });
    }
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
}
