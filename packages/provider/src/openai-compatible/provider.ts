/**
 * OpenAICompatibleProvider · OpenAI 兼容协议 Provider 基类
 * ---------------------------------------------
 * (v0.6.0-beta.2 抽离；原逻辑来自 `packages/provider/src/qwen/index.ts`)
 *
 * 承担所有"OpenAI 兼容端点共通"的职责：
 * - 用 `@ai-sdk/openai` 的 `createOpenAI` 构造客户端（baseURL + apiKey）
 * - 通过 `ai` 的 `streamText` 发起流式请求，遍历 `fullStream`
 * - AI SDK stream part → `ChatChunk` 归一化（含 reasoning-delta / tool-call / usage / finish）
 * - `ChatMessage[]` → AI SDK `CoreMessage[]` 转换（含 assistant.toolCalls / tool 角色）
 * - `ToolDefinition[]` → AI SDK `Tool` 映射 + JSON Schema → zod 极简转换
 * - Abort / error 分类
 *
 * 子类需覆盖：
 * - `getModelInfo()`：按各自 capability 表返回
 * - `getProviderOptions()`（可选）：透传特化 extra_body（如 Qwen 的 `enable_thinking`）
 *
 * 不负责：
 * - 配置 schema 校验（各 Provider 的 config.ts 里 safeParse 后再传进来）
 * - `/embeddings` / `/models` 等非 chat 协议（在同目录 embedding.ts / list-models.ts 里）
 */
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { streamText, type CoreMessage, type Tool } from 'ai';
import { z } from 'zod';
import {
  createLogger,
  maskSecret,
  type ChatChunk,
  type ChatMessage,
  type ToolDefinition,
} from '@doc-assistant/shared';
import type { ChatParams, LLMProvider, ModelInfo } from '../interface';
import { normalizeStreamPart, type UnknownStreamPart } from './normalizer';
import { safeParseJSON } from './config';

/** 基础字段：所有 OpenAI 兼容 Provider 都需要这些 */
export interface OpenAICompatibleBaseParams {
  apiKey: string;
  baseURL: string;
  model: string;
}

/** 子类可覆盖的 provider 级选项；`logName` 用于日志前缀区分 */
export interface OpenAICompatibleProviderOptions {
  /** 日志 namespace；子类通常传 'provider:qwen' / 'provider:deepseek' */
  logName: string;
}

/**
 * OpenAICompatibleProvider 基类
 *
 * 使用方式：
 * ```ts
 * class DeepSeekProvider extends OpenAICompatibleProvider {
 *   constructor(config) {
 *     super(config, { logName: 'provider:deepseek' });
 *   }
 *   getModelInfo(): ModelInfo { ... }
 * }
 * ```
 */
export abstract class OpenAICompatibleProvider implements LLMProvider {
  protected readonly baseConfig: OpenAICompatibleBaseParams;
  protected readonly client: OpenAIProvider;
  protected readonly logger: ReturnType<typeof createLogger>;

  constructor(config: OpenAICompatibleBaseParams, opts: OpenAICompatibleProviderOptions) {
    this.baseConfig = config;
    this.client = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.logger = createLogger(opts.logName);
    this.logger.info(`${opts.logName} 初始化完成`, {
      baseURL: config.baseURL,
      model: config.model,
      apiKey: maskSecret(config.apiKey),
    });
  }

  abstract getModelInfo(): ModelInfo;

  /**
   * 子类可覆盖：返回要透传给 AI SDK 的 `providerOptions`（会合并入 streamText 调用）。
   * 用于透传各家扩展字段（如 Qwen 的 `enable_thinking`）。
   */
  protected getProviderOptions(_params: ChatParams): Record<string, unknown> | undefined {
    return undefined;
  }

  async *chat(params: ChatParams): AsyncIterable<ChatChunk> {
    const modelId = params.modelOverride ?? this.baseConfig.model;
    const coreMessages = this.toCoreMessages(params.messages);
    const tools = this.toAISDKTools(params.tools);
    const providerOptions = this.getProviderOptions(params);
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
        ...(providerOptions
          ? {
              providerOptions: providerOptions as NonNullable<
                Parameters<typeof streamText>[0]['providerOptions']
              >,
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
      if ((err as Error).name === 'AbortError') {
        this.logger.info('provider call aborted', {
          model: modelId,
          elapsedMs: Date.now() - startedAt,
        });
        yield { type: 'finish', finishReason: 'abort' };
        return;
      }
      this.logger.error('provider call failed', {
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
      this.logger.info('provider call ok', {
        model: modelId,
        elapsedMs: Date.now() - startedAt,
        finishReason: finishReason ?? 'unknown',
      });
    }
  }

  /** 将 shared 的 ChatMessage 转换为 AI SDK 的 CoreMessage */
  protected toCoreMessages(messages: ChatMessage[]): CoreMessage[] {
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

  /** 将 shared 的 ToolDefinition 转换为 AI SDK 的 Tool */
  protected toAISDKTools(
    tools?: ToolDefinition[],
  ): Record<string, Tool> | undefined {
    if (!tools?.length) return undefined;
    const out: Record<string, Tool> = {};
    for (const t of tools) {
      out[t.name] = {
        description: t.description,
        parameters: jsonSchemaToZod(t.parametersJsonSchema),
      } as Tool;
    }
    return out;
  }
}

/**
 * 最小可用的 JSON Schema → zod 转换
 * ---------------------------------------------
 * 仅支持本项目 tools 中会用到的形态：object + string/number/boolean/array + required。
 * 复杂 schema 不支持；当前够用。
 */
export function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
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
