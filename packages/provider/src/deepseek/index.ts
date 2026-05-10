/**
 * DeepSeekProvider · DeepSeek 大模型适配
 * ---------------------------------------------
 * v0.6.0-beta.2:
 * - chat 链路从 AI SDK 切到自己解析 OpenAI SSE(详见 openai-compatible/sse-chat.ts)
 * - 思考模式字段直接合并进请求体顶层(以前通过 AI SDK providerOptions 间接透传,
 *   v1.x AI SDK 会按白名单序列化把 `thinking` 吞掉,导致开关失效)
 * - 子类扩展从"override protected 方法"改为"在构造函数注册 hook"
 *
 * 端点 `https://api.deepseek.com` 在 chat / tools / reasoning / usage 四条路径上
 * 完全兼容 OpenAI 协议。特化:
 * - `getModelInfo()` 按 DEEPSEEK_MODEL_CAPABILITIES 表填充
 * - `request:body` hook(`deepseek:thinking`)把统一的 `thinking: boolean` 翻译为请求体顶层
 *   `thinking: { type: 'enabled' | 'disabled' }`(DeepSeek 官方 API 规范,
 *   与 `model`/`messages` 同级;详见 https://api-docs.deepseek.com/api/create-chat-completion)。
 *   enabled/disabled 两种都显式透传(DeepSeek 关闭思考需要显式 `disabled`,与 Qwen 不同)。
 * - `message:outgoing` hook(`deepseek:reasoning-content`)把 ChatMessage.reasoning
 *   注入到 assistant OpenAIMessage.reasoning_content,满足 DeepSeek 多轮协议要求。
 */
import { ProviderError, compact } from '@doc-assistant/shared';
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
      thinking: this.deepSeekConfig.thinking,
    });

    // 1) 思考模式字段(请求体顶层)。enabled/disabled 都显式透传——关闭思考需显式告知。
    this.hooks.register({
      kind: 'request:body',
      name: 'deepseek:thinking',
      fn: (body) => ({
        ...body,
        thinking: { type: this.deepSeekConfig.thinking ? 'enabled' : 'disabled' },
      }),
    });

    // 2) 多轮对话回传 reasoning_content(协议要求);仅对 assistant 角色生效。
    //    `reasoning || undefined` 把空串归一,再由 compact 剔除(语义=truthy 才注入)。
    //    `removeNull: false` 保留 `content: null`(tool_calls 场景故意保留)。
    this.hooks.register({
      kind: 'message:outgoing',
      name: 'deepseek:reasoning-content',
      fn: (msg, ctx) => {
        if (ctx.source.role !== 'assistant') return msg;
        return compact(
          { ...msg, reasoning_content: ctx.source.reasoning || undefined },
          { removeNull: false },
        );
      },
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
}
