/**
 * OpenAICompatibleProvider · OpenAI 兼容协议 Provider 基类
 * ---------------------------------------------
 * v0.6.0-beta.2:chat 链路从 Vercel AI SDK 切到自己写的 sse-chat。
 *
 * 切换原因(详见 docs/CHANGELOG.md 与 docs/TROUBLESHOOTING.md):
 * - `@ai-sdk/openai` v1.x 按 OpenAI 协议白名单序列化请求体,DeepSeek 思考模式所需的
 *   顶层 `thinking` 字段会被吞;下行 `delta.reasoning_content` 也不在 v1 解析路径,
 *   导致思考模式开关失效、ThinkingBlock 不显示、第 2 轮工具调用因缺 reasoning_content
 *   被 DeepSeek 400 拒绝。
 * - 自己写 fetch + SSE 解析后,任何 OpenAI 协议方言字段都由我们直接控制透传。
 *
 * 本基类承担:
 * - 用 `runOpenAIChatStream` 发起流式请求,转发 ChatChunk 给 Agent 层
 * - `ChatMessage[]` → OpenAI 协议 `messages` 数组(含 assistant.tool_calls /
 *   tool 角色)
 * - `ToolDefinition[]` → OpenAI 协议 `tools` 数组(直接透传 JSON Schema)
 * - 通过 HookRegistry 把子类注册的 hook 串成流水线:
 *   · `request:body`     · 装饰整个 chat completions 请求体
 *   · `message:outgoing` · 装饰单条 ChatMessage 转换后的 OpenAIMessage
 *
 * 子类需覆盖:
 * - `getModelInfo()`:按各自 capability 表返回
 *
 * 子类**扩展行为的方式**(不要 override 基类方法,统一注册 hook):
 * - 在构造函数里 `this.hooks.register({ kind, name, priority?, fn })`
 *   · DeepSeek → 注册 `request:body` 把 thinking 翻译为 `{ thinking: { type } }`
 *               + 注册 `message:outgoing` 把 reasoning 注入 reasoning_content
 *   · Qwen     → 注册 `request:body` 把 thinking=true 翻译为
 *               `extra_body.enable_thinking=true`(thinking=false 时不注册)
 *
 * 不负责:
 * - 配置 schema 校验(各 Provider 的 config.ts 里 safeParse 后再传进来)
 * - `/embeddings` / `/models` 等非 chat 协议(同目录 embedding.ts / list-models.ts)
 */
import {
  createLogger,
  maskSecret,
  compact,
  type ChatChunk,
  type ChatMessage,
  type ToolDefinition,
} from '@doc-assistant/shared';
import type { ChatParams, LLMProvider, ModelInfo } from '../interface';
import {
  runOpenAIChatStream,
  type OpenAIChatRequest,
  type OpenAIMessage,
  type OpenAITool,
} from './sse-chat';
import { joinUrl } from './config';
import { HookRegistry } from './hooks';

/** 基础字段:所有 OpenAI 兼容 Provider 都需要这些 */
export interface OpenAICompatibleBaseParams {
  apiKey: string;
  baseURL: string;
  model: string;
}

/** 子类可覆盖的 provider 级选项;`logName` 用于日志前缀区分 */
export interface OpenAICompatibleProviderOptions {
  /** 日志 namespace;子类通常传 'provider:qwen' / 'provider:deepseek' */
  logName: string;
}

/**
 * OpenAICompatibleProvider 基类
 *
 * 使用方式:
 * ```ts
 * class DeepSeekProvider extends OpenAICompatibleProvider {
 *   constructor(config) {
 *     super(config, { logName: 'provider:deepseek' });
 *     this.hooks.register({
 *       kind: 'request:body',
 *       name: 'deepseek:thinking',
 *       fn: (body) => ({ ...body, thinking: { type: 'enabled' } }),
 *     });
 *   }
 *   getModelInfo(): ModelInfo { ... }
 * }
 * ```
 */
export abstract class OpenAICompatibleProvider implements LLMProvider {
  protected readonly baseConfig: OpenAICompatibleBaseParams;
  protected readonly logger: ReturnType<typeof createLogger>;
  protected readonly hooks = new HookRegistry();

  constructor(config: OpenAICompatibleBaseParams, opts: OpenAICompatibleProviderOptions) {
    this.baseConfig = config;
    this.logger = createLogger(opts.logName);
    this.logger.info(`${opts.logName} 初始化完成`, {
      baseURL: config.baseURL,
      model: config.model,
      apiKey: maskSecret(config.apiKey),
    });
  }

  abstract getModelInfo(): ModelInfo;

  async *chat(params: ChatParams): AsyncIterable<ChatChunk> {
    const modelId = params.modelOverride ?? this.baseConfig.model;
    const messages = this.toOpenAIMessages(params.messages, params);
    const tools = this.toOpenAITools(params.tools);
    const startedAt = Date.now();

    let body: OpenAIChatRequest = {
      model: modelId,
      messages,
      stream: true,
      ...compact({
        tools,
        temperature: params.temperature,
      }),
    };
    body = this.hooks.runRequestBody(body, { params });

    const url = joinUrl(this.baseConfig.baseURL, '/chat/completions');
    let finishReason: string | undefined;
    let errored = false;

    for await (const chunk of runOpenAIChatStream({
      url,
      apiKey: this.baseConfig.apiKey,
      body,
      ...compact({ signal: params.signal }),
      logger: this.logger,
    })) {
      if (chunk.type === 'finish') finishReason = chunk.finishReason;
      if (chunk.type === 'error') errored = true;
      yield chunk;
    }

    this.logger.info(errored ? 'provider call failed' : 'provider call ok', {
      model: modelId,
      elapsedMs: Date.now() - startedAt,
      finishReason: finishReason ?? 'unknown',
    });
  }

  /**
   * 将 shared 的 ChatMessage 转换为 OpenAI 协议 messages 数组。
   *
   * - system / user:简单透传 content
   * - assistant 文本:`{ role: 'assistant', content }`
   * - assistant 含 tool_calls:`{ role, content?, tool_calls: [...] }`,
   *   args 为对象时 stringify(OpenAI 协议要求 arguments 为 JSON 字符串)。
   * - tool:`{ role: 'tool', tool_call_id, content }`,content 直接为字符串
   *   (上层 agent loop 已 serializeToolResult 过,这里不再嵌套 array,避免双重 stringify
   *    导致 DeepSeek 严格校验 400)
   *
   * 协议方言级别的字段补丁(例如 DeepSeek 的 `reasoning_content` 多轮回传)由子类
   * 通过注册 `message:outgoing` hook 实现,基类对此类厂商专属字段保持无知。
   */
  protected toOpenAIMessages(messages: ChatMessage[], params: ChatParams): OpenAIMessage[] {
    const out: OpenAIMessage[] = [];
    for (const msg of messages) {
      const converted = this.convertSingleMessage(msg);
      if (converted) {
        out.push(this.hooks.runMessageOutgoing(converted, { params, source: msg }));
      }
    }
    return out;
  }

  /**
   * 单条 ChatMessage → OpenAIMessage 的纯字段映射(不含厂商方言补丁)。
   * 不可识别的 role 返回 undefined,由调用方丢弃。
   */
  private convertSingleMessage(msg: ChatMessage): OpenAIMessage | undefined {
    switch (msg.role) {
      case 'system':
        return { role: 'system', content: msg.content ?? '' };
      case 'user':
        return { role: 'user', content: msg.content ?? '' };
      case 'assistant': {
        if (msg.toolCalls?.length) {
          return {
            role: 'assistant',
            // OpenAI 协议允许 tool_calls 同时携带 content;无文本时给 null(部分上游对空串敏感)
            content: msg.content ?? null,
            tool_calls: msg.toolCalls.map((c) => ({
              id: c.id,
              type: 'function' as const,
              function: {
                name: c.name,
                arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? {}),
              },
            })),
          };
        }
        return { role: 'assistant', content: msg.content ?? '' };
      }
      case 'tool':
        return {
          role: 'tool',
          tool_call_id: msg.toolCallId ?? '',
          content: msg.content ?? '',
        };
      default:
        return undefined;
    }
  }

  /**
   * 将 shared 的 ToolDefinition 转换为 OpenAI 协议 tools 数组。
   * JSON Schema 直接透传,不再过 zod 中转(OpenAI 协议本就吃 JSON Schema)。
   */
  protected toOpenAITools(tools?: ToolDefinition[]): OpenAITool[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parametersJsonSchema,
      },
    }));
  }
}
