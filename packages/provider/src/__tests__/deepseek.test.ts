/**
 * 单测：DeepSeekProvider · config + listDeepSeekModels + chat-stream mock
 * ---------------------------------------------
 * 覆盖 AC-COMPAT-2 列出的场景：
 * - 配置校验（INVALID_CONFIG）
 * - getModelInfo 对当前线上两款模型（deepseek-v4-flash / deepseek-v4-pro）的返回
 * - Chat stream mock（通过 mock streamText 的 fullStream 走 normalizer）：
 *   text-delta / tool-call / reasoning-delta / usage / finish
 *   这部分直接通过 normalizer 测试覆盖，不走真实 AI SDK（避免依赖网络）
 * - listDeepSeekModels：正常路径（所有条目都归类为 chat）+ 错误路径（401 / 429 / 500）
 *
 * 说明：reasoning-delta 链路保留（DeepSeek 官方 OpenAI 兼容协议仍可能在 `deepseek-v4-pro`
 * 上返回 reasoning 字段），但测试断言**不再绑定特定模型名**——只要上游发出
 * `reasoning` / `reasoning-delta` part，normalizer 就应正确归一化。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@doc-assistant/shared';
import { DeepSeekProvider } from '../deepseek/index';
import {
  DEEPSEEK_MODEL_CAPABILITIES,
  deepSeekProviderConfigSchema,
} from '../deepseek/config';
import { listDeepSeekModels, classifyDeepSeekModel } from '../deepseek/list-models';
import { normalizeStreamPart } from '../openai-compatible/normalizer';

const VALID = {
  apiKey: 'sk-deepseek-test-123',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-v4-pro',
  thinking: false as boolean,
};

describe('DeepSeekProvider · config 校验', () => {
  it('合法配置通过 schema', () => {
    expect(deepSeekProviderConfigSchema.safeParse(VALID).success).toBe(true);
  });

  it('缺失 apiKey → safeParse 失败，构造抛 INVALID_CONFIG', () => {
    expect(deepSeekProviderConfigSchema.safeParse({ ...VALID, apiKey: '' }).success).toBe(false);
    expect(() => new DeepSeekProvider({ ...VALID, apiKey: '' })).toThrow(ProviderError);
  });

  it('非 URL 的 baseURL 被拒绝', () => {
    expect(() => new DeepSeekProvider({ ...VALID, baseURL: 'not-a-url' })).toThrow(ProviderError);
  });

  it('空 model 被拒绝', () => {
    expect(() => new DeepSeekProvider({ ...VALID, model: '' })).toThrow(ProviderError);
  });
});

describe('DeepSeekProvider · getModelInfo', () => {
  it('deepseek-v4-flash → 命中能力表，supportsTools=true', () => {
    const p = new DeepSeekProvider({ ...VALID, model: 'deepseek-v4-flash' });
    const info = p.getModelInfo();
    expect(info.id).toBe('deepseek-v4-flash');
    expect(info.supportsTools).toBe(true);
    expect(info.contextWindow).toBe(
      DEEPSEEK_MODEL_CAPABILITIES['deepseek-v4-flash']!.contextWindow,
    );
    // 规格登记（2026-05-07）：1M 上下文 / 384K 最大输出
    expect(info.contextWindow).toBe(1_000_000);
    expect(info.maxOutputTokens).toBe(384_000);
  });

  it('deepseek-v4-pro → 命中能力表，thinking 开关不改变 ModelInfo', () => {
    const p1 = new DeepSeekProvider({
      ...VALID,
      model: 'deepseek-v4-pro',
      thinking: false,
    });
    const p2 = new DeepSeekProvider({
      ...VALID,
      model: 'deepseek-v4-pro',
      thinking: true,
    });
    expect(p1.getModelInfo().id).toBe('deepseek-v4-pro');
    expect(p2.getModelInfo().id).toBe('deepseek-v4-pro');
    // 两个开关态下 supportsReasoning 保持一致（不受 UI 意图影响）
    expect(p1.getModelInfo().supportsReasoning).toBe(p2.getModelInfo().supportsReasoning);
    expect(p1.getModelInfo().contextWindow).toBe(
      DEEPSEEK_MODEL_CAPABILITIES['deepseek-v4-pro']!.contextWindow,
    );
    // 规格登记：1M / 384K
    expect(p1.getModelInfo().contextWindow).toBe(1_000_000);
    expect(p1.getModelInfo().maxOutputTokens).toBe(384_000);
  });

  it('能力表直接断言：v4-flash / v4-pro 都声明 1M 上下文 + 384K 最大输出', () => {
    expect(DEEPSEEK_MODEL_CAPABILITIES['deepseek-v4-flash']!.contextWindow).toBe(1_000_000);
    expect(DEEPSEEK_MODEL_CAPABILITIES['deepseek-v4-flash']!.maxOutputTokens).toBe(384_000);
    expect(DEEPSEEK_MODEL_CAPABILITIES['deepseek-v4-pro']!.contextWindow).toBe(1_000_000);
    expect(DEEPSEEK_MODEL_CAPABILITIES['deepseek-v4-pro']!.maxOutputTokens).toBe(384_000);
  });

  it('未知模型走 DEFAULT capability（保守假设）', () => {
    const p = new DeepSeekProvider({ ...VALID, model: 'deepseek-future-x' });
    const info = p.getModelInfo();
    expect(info.id).toBe('deepseek-future-x');
    expect(info.contextWindow).toBeGreaterThan(0);
    expect(info.supportsTools).toBe(true);
    expect(info.supportsReasoning).toBe(false);
    // DEFAULT 能力表不声明 maxOutputTokens（未知模型不做乐观假设）
    expect(info.maxOutputTokens).toBeUndefined();
  });
});

describe('DeepSeekProvider · getProviderOptions 透传 thinking 字段', () => {
  /** 访问 protected getProviderOptions 做断言用的窄接口 */
  type OptionsReader = {
    getProviderOptions: (p: unknown) => Record<string, unknown> | undefined;
  };

  it('thinking=true → providerOptions.openai.thinking = { type: "enabled" }（Provider 层翻译）', () => {
    const p = new DeepSeekProvider({ ...VALID, thinking: true });
    const opts = (p as unknown as OptionsReader).getProviderOptions({ messages: [] });
    // 官方 API: 请求体顶层 `thinking: { type }` 与 `model`/`messages` 同级；
    // 通过 @ai-sdk/openai 的 providerOptions.openai 透传
    expect(opts).toEqual({ openai: { thinking: { type: 'enabled' } } });
  });

  it('thinking=false → providerOptions.openai.thinking = { type: "disabled" }（显式透传，与 Qwen 不同）', () => {
    const p = new DeepSeekProvider({ ...VALID, thinking: false });
    const opts = (p as unknown as OptionsReader).getProviderOptions({ messages: [] });
    expect(opts).toEqual({ openai: { thinking: { type: 'disabled' } } });
  });

  it('未显式传 thinking → schema default `true` 生效 → 翻译为 enabled', () => {
    // 构造时不传 thinking：zod `default(true)` 会自动填入
    const cfg = { apiKey: VALID.apiKey, baseURL: VALID.baseURL, model: VALID.model };
    const p = new DeepSeekProvider(cfg as never);
    const opts = (p as unknown as OptionsReader).getProviderOptions({ messages: [] });
    expect(opts).toEqual({ openai: { thinking: { type: 'enabled' } } });
  });
});

describe('DeepSeekProvider · 流式归一化覆盖（AC-MAIN-1/-3/-4）', () => {
  it('text-delta 逐字拼接', () => {
    const chunks = [
      ...normalizeStreamPart({ type: 'text-delta', textDelta: '你好' }),
      ...normalizeStreamPart({ type: 'text-delta', textDelta: '世界' }),
    ];
    const text = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => (c as { delta: string }).delta)
      .join('');
    expect(text).toBe('你好世界');
  });

  it('上游发出 reasoning / reasoning-delta 分支时正确归一化（不依赖具体模型名）', () => {
    // DeepSeek 官方 OpenAI 兼容协议仍可能返回 reasoning_content；
    // 只要 AI SDK 把它翻译成 reasoning / reasoning-delta part，normalizer 就得归一化为
    // ChatChunk.reasoning-delta。此断言不再绑定特定模型（v4 两档均未强制声明 reasoning 能力）。
    const chunks = [
      ...normalizeStreamPart({ type: 'reasoning', textDelta: '让我先分析' }),
      ...normalizeStreamPart({ type: 'reasoning-delta', textDelta: '这道题的结构' }),
    ];
    const reasoning = chunks
      .filter((c) => c.type === 'reasoning-delta')
      .map((c) => (c as { delta: string }).delta)
      .join('');
    expect(reasoning).toBe('让我先分析这道题的结构');
  });

  it('tool-call 流式分块被归一为 tool-call chunk（AC-MAIN-2）', () => {
    const chunks = normalizeStreamPart({
      type: 'tool-call',
      toolCallId: 'call_deepseek_1',
      toolName: 'recall_memory',
      args: { query: '上次我们聊的 agent loop' },
    });
    expect(chunks).toHaveLength(1);
    const first = chunks[0]!;
    expect(first.type).toBe('tool-call');
    if (first.type === 'tool-call') {
      expect(first.call.name).toBe('recall_memory');
      expect(first.call.id).toBe('call_deepseek_1');
    }
  });

  it('finish 带 usage 能被提取（AC-MAIN-4）', () => {
    const chunks = normalizeStreamPart({
      type: 'finish',
      finishReason: 'stop',
      usage: { promptTokens: 120, completionTokens: 45, reasoningTokens: 88 },
    });
    expect(chunks).toEqual([
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: 120, completionTokens: 45, reasoningTokens: 88 },
      },
    ]);
  });

  it('finish 缺 usage 字段不抛异常（AC-MAIN-4 兜底）', () => {
    const chunks = normalizeStreamPart({ type: 'finish', finishReason: 'stop' });
    expect(chunks).toEqual([{ type: 'finish', finishReason: 'stop' }]);
  });
});

describe('listDeepSeekModels', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockOk(ids: string[]) {
    const payload = {
      object: 'list',
      data: ids.map((id) => ({ id, object: 'model', owned_by: 'deepseek' })),
    };
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
      async text() {
        return JSON.stringify(payload);
      },
    } as unknown as Response);
  }

  it('正常路径：全部归类为 chat（DeepSeek 官方无 embedding）', async () => {
    globalThis.fetch = mockOk([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
    ]) as unknown as typeof globalThis.fetch;

    const items = await listDeepSeekModels({
      apiKey: 'sk-x',
      baseURL: 'https://api.deepseek.com',
    });

    expect(items).toHaveLength(2);
    for (const i of items) {
      expect(i.kind).toBe('chat');
    }
    // 字典序
    expect(items.map((i) => i.id)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
  });

  it('命中能力表的模型有 capability 填充', async () => {
    globalThis.fetch = mockOk([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-custom-finetune',
    ]) as unknown as typeof globalThis.fetch;

    const items = await listDeepSeekModels({
      apiKey: 'sk-x',
      baseURL: 'https://api.deepseek.com',
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId['deepseek-v4-flash']?.capability).toBeDefined();
    expect(byId['deepseek-v4-pro']?.capability).toBeDefined();
    expect(byId['deepseek-v4-pro']?.capability?.supportsTools).toBe(true);
    expect(byId['deepseek-custom-finetune']?.capability).toBeUndefined();
  });

  it('classifyDeepSeekModel 返回 chat（所有情况）', () => {
    expect(classifyDeepSeekModel('deepseek-v4-flash')).toBe('chat');
    expect(classifyDeepSeekModel('deepseek-v4-pro')).toBe('chat');
    expect(classifyDeepSeekModel('anything-else')).toBe('chat');
  });

  it('HTTP 401 → LIST_MODELS_HTTP_ERROR（AC-MAIN-5 错误路径）', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      async text() {
        return 'invalid api key';
      },
    } as unknown as Response) as unknown as typeof globalThis.fetch;

    await expect(
      listDeepSeekModels({ apiKey: 'sk-bad', baseURL: 'https://api.deepseek.com' }),
    ).rejects.toMatchObject({ code: 'LIST_MODELS_HTTP_ERROR' });
  });

  it('HTTP 429 → LIST_MODELS_HTTP_ERROR', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      async text() {
        return 'rate limit exceeded';
      },
    } as unknown as Response) as unknown as typeof globalThis.fetch;

    await expect(
      listDeepSeekModels({ apiKey: 'sk-x', baseURL: 'https://api.deepseek.com' }),
    ).rejects.toMatchObject({ code: 'LIST_MODELS_HTTP_ERROR' });
  });

  it('HTTP 500 → LIST_MODELS_HTTP_ERROR', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      async text() {
        return 'internal error';
      },
    } as unknown as Response) as unknown as typeof globalThis.fetch;

    await expect(
      listDeepSeekModels({ apiKey: 'sk-x', baseURL: 'https://api.deepseek.com' }),
    ).rejects.toMatchObject({ code: 'LIST_MODELS_HTTP_ERROR' });
  });

  it('AbortError → ABORTED', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    globalThis.fetch = vi.fn().mockRejectedValue(abortErr) as unknown as typeof globalThis.fetch;

    await expect(
      listDeepSeekModels({ apiKey: 'sk-x', baseURL: 'https://api.deepseek.com' }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('网络错误 → NETWORK_ERROR', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof globalThis.fetch;

    await expect(
      listDeepSeekModels({ apiKey: 'sk-x', baseURL: 'https://api.deepseek.com' }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
