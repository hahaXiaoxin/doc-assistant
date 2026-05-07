/**
 * 单测：DeepSeekProvider · config + listDeepSeekModels + chat-stream mock
 * ---------------------------------------------
 * 覆盖 AC-COMPAT-2 列出的场景：
 * - 配置校验（INVALID_CONFIG）
 * - getModelInfo 对 deepseek-chat / deepseek-reasoner 的返回
 * - Chat stream mock（通过 mock streamText 的 fullStream 走 normalizer）：
 *   text-delta / tool-call / reasoning-delta / usage / finish
 *   这部分直接通过 normalizer 测试覆盖，不走真实 AI SDK（避免依赖网络）
 * - listDeepSeekModels：正常路径（所有条目都归类为 chat）+ 错误路径（401 / 429 / 500）
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
  model: 'deepseek-chat',
  enableThinking: false,
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
  it('deepseek-chat → supportsReasoning=false, supportsTools=true', () => {
    const p = new DeepSeekProvider({ ...VALID, model: 'deepseek-chat' });
    const info = p.getModelInfo();
    expect(info.id).toBe('deepseek-chat');
    expect(info.supportsReasoning).toBe(false);
    expect(info.supportsTools).toBe(true);
    expect(info.contextWindow).toBe(DEEPSEEK_MODEL_CAPABILITIES['deepseek-chat']!.contextWindow);
  });

  it('deepseek-reasoner → supportsReasoning=true（不受 enableThinking 开关影响）', () => {
    const p1 = new DeepSeekProvider({
      ...VALID,
      model: 'deepseek-reasoner',
      enableThinking: false,
    });
    expect(p1.getModelInfo().supportsReasoning).toBe(true);

    const p2 = new DeepSeekProvider({
      ...VALID,
      model: 'deepseek-reasoner',
      enableThinking: true,
    });
    expect(p2.getModelInfo().supportsReasoning).toBe(true);
  });

  it('未知模型走 DEFAULT capability（保守假设）', () => {
    const p = new DeepSeekProvider({ ...VALID, model: 'deepseek-future-x' });
    const info = p.getModelInfo();
    expect(info.id).toBe('deepseek-future-x');
    expect(info.contextWindow).toBeGreaterThan(0);
    expect(info.supportsTools).toBe(true);
    expect(info.supportsReasoning).toBe(false);
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

  it('reasoning-delta（deepseek-reasoner 的 reasoning_content）逐字拼接', () => {
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
      'deepseek-chat',
      'deepseek-reasoner',
      'deepseek-coder-v2',
    ]) as unknown as typeof globalThis.fetch;

    const items = await listDeepSeekModels({
      apiKey: 'sk-x',
      baseURL: 'https://api.deepseek.com',
    });

    expect(items).toHaveLength(3);
    for (const i of items) {
      expect(i.kind).toBe('chat');
    }
    // 字典序
    expect(items.map((i) => i.id)).toEqual([
      'deepseek-chat',
      'deepseek-coder-v2',
      'deepseek-reasoner',
    ]);
  });

  it('命中能力表的模型有 capability 填充', async () => {
    globalThis.fetch = mockOk([
      'deepseek-chat',
      'deepseek-reasoner',
      'deepseek-custom-finetune',
    ]) as unknown as typeof globalThis.fetch;

    const items = await listDeepSeekModels({
      apiKey: 'sk-x',
      baseURL: 'https://api.deepseek.com',
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId['deepseek-chat']?.capability).toBeDefined();
    expect(byId['deepseek-reasoner']?.capability?.supportsReasoning).toBe(true);
    expect(byId['deepseek-custom-finetune']?.capability).toBeUndefined();
  });

  it('classifyDeepSeekModel 返回 chat（所有情况）', () => {
    expect(classifyDeepSeekModel('deepseek-chat')).toBe('chat');
    expect(classifyDeepSeekModel('deepseek-reasoner')).toBe('chat');
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
