/**
 * runOpenAIChatStream · 裸 fetch + SSE 解析
 * ---------------------------------------------
 * v0.6.0-beta.2：把 chat 链路从 Vercel AI SDK 切到自己写。
 *
 * 背景：
 * - `@ai-sdk/openai` v1.x 按 OpenAI 协议白名单序列化请求体，DeepSeek 思考模式所需的
 *   顶层 `thinking` 字段会被吞；下行 `delta.reasoning_content` 也不在 v1 解析路径里。
 * - 自己写 fetch + SSE 解析后，任何 OpenAI 协议方言字段（thinking / reasoning_content /
 *   cache_control / extra_body / ...）都由我们直接控制透传。
 *
 * 这个函数干 4 件事:
 * 1. POST 请求体到 `${baseURL}/chat/completions`，错误归一化到 ProviderError
 * 2. 解析 SSE（`data: <json>\n\n`，含 `[DONE]` 终止 + 跨 buffer 边界）
 * 3. 把每个 chunk 的 delta 翻译成 ChatChunk:
 *    - delta.content        → text-delta
 *    - delta.reasoning_content → reasoning-delta
 *    - delta.tool_calls[]   → 累积器（按 index 拼 arguments，finish 时一次性 yield）
 *    - finish_reason / usage → finish chunk
 * 4. 处理 abort（AbortSignal → 'abort' finish）/ 4xx-5xx（→ ProviderError → error+finish）
 *
 * 不负责：
 * - 把 ChatMessage / ToolDefinition 翻译成 OpenAI 协议形态：那是 OpenAICompatibleProvider 的职责
 * - 思考模式开关、各家方言字段：由 Provider 子类的 `getRequestBodyExtras` 注入
 */
import {
  ProviderError,
  type ChatChunk,
  type ToolCall,
  type createLogger,
} from '@doc-assistant/shared';
import { mapHttpErrorToProviderError, mapFetchErrorToProviderError } from './errors';
import { safeReadText } from './config';

/** OpenAI 协议 chat completions 请求体形状（我们自己控制） */
export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  stream: true;
  /** 各家方言字段（thinking / reasoning_effort / cache_control / extra_body 等）直接透传 */
  [extra: string]: unknown;
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  /** assistant 思考模式回传（DeepSeek 多轮要求） */
  reasoning_content?: string;
  /** assistant tool_calls */
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  /** tool message 的 call id */
  tool_call_id?: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>; // JSON Schema 直接透传
  };
}

type Logger = ReturnType<typeof createLogger>;

export interface RunOpenAIChatStreamArgs {
  /** 完整 URL，例如 'https://api.deepseek.com/chat/completions' */
  url: string;
  apiKey: string;
  body: OpenAIChatRequest;
  signal?: AbortSignal;
  logger: Logger;
}

/** ChatChunk 的 finishReason 联合（从 ChatChunk 里抽出来供本文件复用） */
type ChatFinishReason = Extract<ChatChunk, { type: 'finish' }>['finishReason'];

/**
 * 发起 OpenAI 协议流式 chat 请求，把 SSE 流归一化为 ChatChunk[]。
 *
 * 调用方契约：必定恰好 yield 一个 finish chunk（除非提前 throw，但我们这里把所有错误
 * 都吞成 error+finish chunk 对，与原 OpenAICompatibleProvider.chat 行为一致）。
 */
export async function* runOpenAIChatStream(
  args: RunOpenAIChatStreamArgs,
): AsyncIterable<ChatChunk> {
  const { url, apiKey, body, signal, logger } = args;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      yield { type: 'finish', finishReason: 'abort' };
      return;
    }
    const e = mapFetchErrorToProviderError(err, 'chat request');
    logger.warn('chat request fetch error', { code: e.code, message: e.message });
    yield { type: 'error', error: e };
    yield { type: 'finish', finishReason: 'error' };
    return;
  }

  if (!resp.ok) {
    const text = await safeReadText(resp);
    const e = mapHttpErrorToProviderError(resp.status, text, 'chat request');
    logger.warn('chat request http error', { status: resp.status, code: e.code });
    yield { type: 'error', error: e };
    yield { type: 'finish', finishReason: 'error' };
    return;
  }

  if (!resp.body) {
    const e = new ProviderError('UPSTREAM_ERROR', 'chat request: 上游返回空 body');
    yield { type: 'error', error: e };
    yield { type: 'finish', finishReason: 'error' };
    return;
  }

  // tool_calls 累积器：key 为 index，按 index 拼 arguments
  const toolCallBuf = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: ChatFinishReason | undefined;
  let usage: { promptTokens?: number; completionTokens?: number; reasoningTokens?: number } | undefined;
  let aborted = false;

  try {
    for await (const event of readSSE(resp.body, signal)) {
      if (event === '[DONE]') break;
      const parsed = safeJSON(event);
      if (!parsed) {
        logger.debug('忽略无法解析的 SSE 数据帧:', event.slice(0, 200));
        continue;
      }
      // OpenAI 协议错误也可能以 SSE 帧形态出现（少见，但 DeepSeek/Qwen 真实存在）
      const errPayload = (parsed as { error?: unknown }).error;
      if (errPayload) {
        const msg = typeof errPayload === 'string'
          ? errPayload
          : ((errPayload as { message?: unknown }).message);
        const e = new ProviderError(
          'UPSTREAM_ERROR',
          `chat stream error: ${typeof msg === 'string' ? msg : JSON.stringify(errPayload)}`,
        );
        yield { type: 'error', error: e };
        finishReason = 'error';
        break;
      }

      const choices = (parsed as { choices?: unknown }).choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        // 末尾 usage-only chunk 也走这条；usage 字段可能挂在顶层
        const u = extractUsage((parsed as { usage?: unknown }).usage);
        if (u) usage = u;
        continue;
      }

      const choice = choices[0] as Record<string, unknown>;
      const delta = (choice.delta ?? {}) as Record<string, unknown>;

      // 1) 文本增量
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        yield { type: 'text-delta', delta: delta.content };
      }

      // 2) reasoning_content 增量（DeepSeek / Qwen 思考模式专属字段）
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
        yield { type: 'reasoning-delta', delta: delta.reasoning_content };
      }

      // 3) tool_calls 累积（按 index 拼 arguments）
      const toolCalls = delta.tool_calls;
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls as Array<Record<string, unknown>>) {
          const idx = typeof tc.index === 'number' ? tc.index : 0;
          const fn = (tc.function ?? {}) as Record<string, unknown>;
          const existing = toolCallBuf.get(idx);
          if (!existing) {
            toolCallBuf.set(idx, {
              id: typeof tc.id === 'string' ? tc.id : '',
              name: typeof fn.name === 'string' ? fn.name : '',
              args: typeof fn.arguments === 'string' ? fn.arguments : '',
            });
          } else {
            if (typeof tc.id === 'string' && tc.id) existing.id = tc.id;
            if (typeof fn.name === 'string' && fn.name) existing.name = fn.name;
            if (typeof fn.arguments === 'string') existing.args += fn.arguments;
          }
        }
      }

      // 4) finish_reason
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        finishReason = normalizeFinishReason(choice.finish_reason);
      }
      // 5) usage（DeepSeek 末尾 chunk 带）
      const u = extractUsage((parsed as { usage?: unknown }).usage);
      if (u) usage = u;
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      aborted = true;
    } else {
      const e = mapFetchErrorToProviderError(err, 'chat stream');
      logger.warn('chat stream read error', { code: e.code, message: e.message });
      yield { type: 'error', error: e };
      yield { type: 'finish', finishReason: 'error' };
      return;
    }
  }

  if (aborted) {
    yield { type: 'finish', finishReason: 'abort' };
    return;
  }

  // 把累积的 tool_calls 一次性 yield（按 index 升序）
  if (toolCallBuf.size > 0) {
    const indices = [...toolCallBuf.keys()].sort((a, b) => a - b);
    for (const idx of indices) {
      const tc = toolCallBuf.get(idx)!;
      if (!tc.id || !tc.name) {
        logger.warn('tool_calls 累积结果缺 id 或 name，丢弃:', tc);
        continue;
      }
      const call: ToolCall = { id: tc.id, name: tc.name, args: tc.args };
      yield { type: 'tool-call', call };
    }
  }

  yield {
    type: 'finish',
    finishReason: finishReason ?? 'stop',
    ...(usage ? { usage } : {}),
  };
}

/**
 * 解析 SSE 流：把 ReadableStream<Uint8Array> 切成一个个 event 的 data 段。
 * - 跨 chunk buffer 边界
 * - 多行 data: 拼接（OpenAI 协议单行就是一条 JSON，但容错处理多行）
 * - 忽略空行 / 注释行（`:`开头）/ 非 data 字段
 * - `data: [DONE]` 直接 yield 字符串 '[DONE]'
 */
async function* readSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  try {
    while (true) {
      if (signal?.aborted) {
        const err: Error & { name?: string } = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // 按 \n\n 切 event
      let sep = buf.indexOf('\n\n');
      while (sep !== -1) {
        const rawEvent = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const data = parseSSEEvent(rawEvent);
        if (data !== undefined) yield data;
        sep = buf.indexOf('\n\n');
      }
    }
    // 收尾：flush decoder + 处理可能没换行结尾的最后一个 event
    buf += decoder.decode();
    if (buf.trim().length > 0) {
      const data = parseSSEEvent(buf);
      if (data !== undefined) yield data;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // 已 release / cancel 的 reader 再 release 会抛，忽略
    }
  }
}

/**
 * 解析单个 SSE event 块（多行）。返回 data 字段拼接结果；非 data 行忽略；
 * 注释行（`:`开头）忽略；event 结构非法返回 undefined。
 */
function parseSSEEvent(raw: string): string | undefined {
  const lines = raw.split('\n');
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.startsWith(':')) continue; // SSE 注释
    // 不强制断在第一个冒号：OpenAI/DeepSeek/Qwen 的 SSE 都是 `data: <json>` 单行格式
    if (line.startsWith('data:')) {
      // 标准 SSE：data: 后允许有一个空格
      const v = line.slice(5).startsWith(' ') ? line.slice(6) : line.slice(5);
      dataLines.push(v);
    }
    // 其它字段（event: / id: / retry:）忽略
  }
  if (dataLines.length === 0) return undefined;
  return dataLines.join('\n');
}

function safeJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** 把 OpenAI 协议 finish_reason 映射到 ChatChunk.finishReason */
export function normalizeFinishReason(raw: unknown): ChatFinishReason {
  switch (raw) {
    case 'stop':
      return 'stop';
    case 'tool-calls':
    case 'tool_calls':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'content-filter':
    case 'content_filter':
      return 'content_filter';
    case 'abort':
    case 'aborted':
      return 'abort';
    case 'error':
      return 'error';
    default:
      return 'other';
  }
}

/**
 * 抽 usage：兼容 OpenAI 协议常见命名(prompt_tokens / completion_tokens) 与
 * DeepSeek 思考模式的 reasoning_tokens 子字段。
 */
export function extractUsage(
  raw: unknown,
): { promptTokens?: number; completionTokens?: number; reasoningTokens?: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
  } = {};
  // OpenAI 协议官方字段
  if (typeof r.prompt_tokens === 'number') out.promptTokens = r.prompt_tokens;
  if (typeof r.completion_tokens === 'number') out.completionTokens = r.completion_tokens;
  // 兼容 AI SDK 风格已驼峰过的字段（保留以便迁移期）
  if (out.promptTokens === undefined && typeof r.promptTokens === 'number') {
    out.promptTokens = r.promptTokens;
  }
  if (out.completionTokens === undefined && typeof r.completionTokens === 'number') {
    out.completionTokens = r.completionTokens;
  }
  // reasoning tokens：DeepSeek 放在 completion_tokens_details.reasoning_tokens
  const details = r.completion_tokens_details;
  if (details && typeof details === 'object') {
    const rt = (details as Record<string, unknown>).reasoning_tokens;
    if (typeof rt === 'number') out.reasoningTokens = rt;
  }
  if (out.reasoningTokens === undefined && typeof r.reasoning_tokens === 'number') {
    out.reasoningTokens = r.reasoning_tokens;
  }
  if (out.reasoningTokens === undefined && typeof r.reasoningTokens === 'number') {
    out.reasoningTokens = r.reasoningTokens;
  }
  return Object.keys(out).length ? out : undefined;
}
