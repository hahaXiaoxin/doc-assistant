/**
 * QwenProvider · 千问大模型适配
 * ---------------------------------------------
 * 设计要点：
 * - 使用 @ai-sdk/openai 的 createOpenAI 构造 client，传入 baseURL + apiKey
 * - 通过 providerOptions.openai 透传千问专属字段：`enable_thinking`
 *   （千问在 OpenAI 兼容模式下通过请求体 extra_body 接收该字段；AI SDK v4 的
 *   OpenAI provider 提供 providerOptions 映射）
 * - 调用 streamText 获取 fullStream，遍历并归一化为 ChatChunk
 * - tool calling 走 AI SDK 的标准 tools 参数，内部转换成 OpenAI tools 格式
 *
 * 安全：
 * - apiKey 只在构造函数内捕获，不写日志、不重新暴露
 * - 错误信息做脱敏
 */
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { streamText, type CoreMessage, type Tool } from 'ai';
import { z } from 'zod';
import {
  createLogger,
  maskSecret,
  ProviderError,
  type ChatChunk,
  type ChatMessage,
  type ToolDefinition,
} from '@doc-assistant/shared';
import type { ChatParams, LLMProvider, ModelInfo } from '../interface';
import { getQwenCapability, qwenProviderConfigSchema, type QwenProviderConfig } from './config';
import { normalizeStreamPart, type UnknownStreamPart } from './normalizer';

const logger = createLogger('provider:qwen');

export class QwenProvider implements LLMProvider {
  private readonly config: QwenProviderConfig;
  private readonly client: OpenAIProvider;

  constructor(config: QwenProviderConfig) {
    const parsed = qwenProviderConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new ProviderError(
        'INVALID_CONFIG',
        `Qwen 配置不合法：${parsed.error.errors.map((e) => e.message).join('; ')}`,
      );
    }
    this.config = parsed.data;
    this.client = createOpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      // 千问的 OpenAI 兼容端点对 organization header 不敏感，留空
    });
    logger.info('QwenProvider 初始化完成', {
      baseURL: this.config.baseURL,
      model: this.config.model,
      enableThinking: this.config.enableThinking,
      apiKey: maskSecret(this.config.apiKey),
    });
  }

  getModelInfo(): ModelInfo {
    const cap = getQwenCapability(this.config.model);
    return {
      id: this.config.model,
      contextWindow: cap.contextWindow,
      supportsReasoning: cap.supportsReasoning && this.config.enableThinking,
      supportsTools: cap.supportsTools,
    };
  }

  async *chat(params: ChatParams): AsyncIterable<ChatChunk> {
    const modelId = params.modelOverride ?? this.config.model;
    const coreMessages = this.toCoreMessages(params.messages);
    const tools = this.toAISDKTools(params.tools);
    // v0.6.0 埋点:记录 provider 调用耗时 + 最终 finishReason
    const startedAt = Date.now();
    let finishReason: string | undefined;
    let errored = false;

    try {
      const result = streamText({
        model: this.client(modelId),
        messages: coreMessages,
        ...(tools ? { tools } : {}),
        ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
        ...(params.signal ? { abortSignal: params.signal } : {}),
        // 千问的 thinking：通过 providerOptions.openai 透传 extra body
        // 参考：AI SDK v4 `providerOptions` 会被 OpenAI provider 合并进请求体（extra_body）
        ...(this.config.enableThinking
          ? {
              providerOptions: {
                openai: {
                  // 千问在 OpenAI 兼容模式下识别 enable_thinking
                  enable_thinking: true,
                },
              },
            }
          : {}),
      });

      for await (const part of result.fullStream as AsyncIterable<UnknownStreamPart>) {
        for (const chunk of normalizeStreamPart(part)) {
          if (chunk.type === 'finish') finishReason = chunk.finishReason;
          yield chunk;
        }
      }
    } catch (err) {
      errored = true;
      // AbortError 单独归类
      if ((err as Error).name === 'AbortError') {
        logger.info('provider call aborted', {
          model: modelId,
          elapsedMs: Date.now() - startedAt,
        });
        yield { type: 'finish', finishReason: 'abort' };
        return;
      }
      logger.error('provider call failed', {
        model: modelId,
        elapsedMs: Date.now() - startedAt,
        error: (err as Error).message,
      });
      yield {
        type: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
      };
      yield { type: 'finish', finishReason: 'error' };
      return;
    }
    if (!errored) {
      logger.info('provider call ok', {
        model: modelId,
        elapsedMs: Date.now() - startedAt,
        finishReason: finishReason ?? 'unknown',
      });
    }
  }

  /**
   * 将 shared 的 ChatMessage 转换为 AI SDK 的 CoreMessage
   */
  private toCoreMessages(messages: ChatMessage[]): CoreMessage[] {
    const out: CoreMessage[] = [];
    for (const msg of messages) {
      switch (msg.role) {
        case 'system':
          out.push({ role: 'system', content: msg.content ?? '' });
          break;
        case 'user':
          out.push({ role: 'user', content: msg.content ?? '' });
          break;
        case 'assistant': {
          // 带 tool_calls 的 assistant 消息：转换为 CoreAssistantMessage 的 content part 数组
          if (msg.toolCalls?.length) {
            out.push({
              role: 'assistant',
              content: [
                ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
                ...msg.toolCalls.map((c) => ({
                  type: 'tool-call' as const,
                  toolCallId: c.id,
                  toolName: c.name,
                  args: typeof c.args === 'string' ? safeParseJSON(c.args) : (c.args ?? {}),
                })),
              ],
            });
          } else {
            out.push({ role: 'assistant', content: msg.content ?? '' });
          }
          break;
        }
        case 'tool': {
          // tool 消息对应 CoreToolMessage
          out.push({
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: msg.toolCallId ?? '',
                toolName: (msg.meta?.toolName as string) ?? 'unknown',
                result: msg.content ?? '',
              },
            ],
          });
          break;
        }
      }
    }
    return out;
  }

  /**
   * 将 shared 的 ToolDefinition 转换为 AI SDK 的 Tool
   * ---------------------------------------------
   * - AI SDK v4 的 Tool 接受 zod schema 或 JSON Schema
   * - 这里我们把 JSON Schema 包装成 zod 兼容的形式；由于本项目的 Tool 都由 @doc-assistant/tools
   *   定义，其 parametersJsonSchema 形态稳定，AI SDK 会透传给 OpenAI 端
   * - execute 由 Agent 层在自研 loop 中执行，不在此处注入 execute，让 AI SDK 只把 tool-call 发回
   *   给我们处理（避免 AI SDK 内部自动闭环执行）
   */
  private toAISDKTools(
    tools?: ToolDefinition[],
  ): Record<string, Tool> | undefined {
    if (!tools?.length) return undefined;
    const out: Record<string, Tool> = {};
    for (const t of tools) {
      out[t.name] = {
        description: t.description,
        parameters: jsonSchemaToZod(t.parametersJsonSchema),
        // 不提供 execute：tool-call 作为 stream part 发出，由 Agent loop 处理
      } as Tool;
    }
    return out;
  }
}

function safeParseJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * 最小可用的 JSON Schema → zod 转换
 * ---------------------------------------------
 * 仅支持本项目 tools 中会用到的形态：object + string/number/boolean/array + required。
 * 复杂 schema 不支持；当前够用。
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const type = schema.type;
  if (type === 'string') return z.string();
  if (type === 'number' || type === 'integer') return z.number();
  if (type === 'boolean') return z.boolean();
  if (type === 'array') {
    const items = (schema.items as Record<string, unknown>) ?? { type: 'string' };
    return z.array(jsonSchemaToZod(items));
  }
  if (type === 'object') {
    const props = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
    const required = new Set((schema.required as string[]) ?? []);
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [k, v] of Object.entries(props)) {
      const sub = jsonSchemaToZod(v);
      shape[k] = required.has(k) ? sub : sub.optional();
    }
    return z.object(shape);
  }
  return z.any();
}
