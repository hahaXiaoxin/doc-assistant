/**
 * 单测：DeepSeekProvider · config + listDeepSeekModels + hook 注册
 * ---------------------------------------------
 * v0.6.0-beta.2 起 chat 流式归一化由 sse-chat 单测覆盖（见 sse-chat.test.ts），
 * 不再依赖 AI SDK part 形态。本文件保留:
 * - 配置校验（INVALID_CONFIG）
 * - getModelInfo 对当前线上两款模型（deepseek-v4-flash / deepseek-v4-pro）的返回
 * - 注册的 `request:body` hook：thinking 开关 → 请求体顶层 thinking.type 字段
 * - 注册的 `message:outgoing` hook：assistant.reasoning → reasoning_content 透出
 * - listDeepSeekModels：正常路径 + 错误路径（401 / 429 / 500）
 *
 * 通过测试桩子类 TestableDeepSeekProvider / TestableQwenProvider 暴露 protected
 * hooks 与 toOpenAIMessages,把"构造时已注册哪些 hook"当成黑盒接口断言,而不是把
 * 基类 protected 字段改成 public(那样会污染生产 API)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError, type ChatMessage } from '@doc-assistant/shared';
import { DeepSeekProvider } from '../deepseek/index';
import { QwenProvider } from '../qwen/index';
import {
  DEEPSEEK_MODEL_CAPABILITIES,
  deepSeekProviderConfigSchema,
} from '../deepseek/config';
import { listDeepSeekModels, classifyDeepSeekModel } from '../deepseek/list-models';
import type { OpenAIChatRequest } from '../openai-compatible/sse-chat';
import type { ChatParams } from '../interface';

const VALID = {
  apiKey: 'sk-deepseek-test-123',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-v4-pro',
  thinking: false as boolean,
};

/** 测试桩:暴露 protected hooks 与 toOpenAIMessages,生产代码保持 protected 不动 */
class TestableDeepSeekProvider extends DeepSeekProvider {
  exposeHooks() {
    return this.hooks;
  }
  exposeToOpenAIMessages(msgs: ChatMessage[], params: ChatParams = { messages: msgs }) {
    return this.toOpenAIMessages(msgs, params);
  }
}

class TestableQwenProvider extends QwenProvider {
  exposeHooks() {
    return this.hooks;
  }
  exposeToOpenAIMessages(msgs: ChatMessage[], params: ChatParams = { messages: msgs }) {
    return this.toOpenAIMessages(msgs, params);
  }
}

/** 把空 body 通过 hooks.runRequestBody 流过一遍,断言输出形状 */
function runHooksOnEmptyBody(p: TestableDeepSeekProvider | TestableQwenProvider): OpenAIChatRequest {
  const empty: OpenAIChatRequest = { model: 'm', messages: [], stream: true };
  return p.exposeHooks().runRequestBody(empty, { params: { messages: [] } });
}

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

describe('DeepSeekProvider · message:outgoing hook 注入 reasoning_content', () => {
  const VALID_QWEN = {
    apiKey: 'sk-qwen-test-123',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-max',
    thinking: false,
  };

  it('assistant 含 reasoning + 无 toolCalls → 出站消息含 reasoning_content', () => {
    const p = new TestableDeepSeekProvider({ ...VALID, thinking: true });
    const msgs: ChatMessage[] = [
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '回答', reasoning: '我先想一下...' },
    ];
    const out = p.exposeToOpenAIMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      role: 'assistant',
      content: '回答',
      reasoning_content: '我先想一下...',
    });
  });

  it('assistant 含 reasoning + toolCalls → 出站消息含 reasoning_content + tool_calls(content 保留 null)', () => {
    const p = new TestableDeepSeekProvider({ ...VALID, thinking: true });
    const msgs: ChatMessage[] = [
      {
        role: 'assistant',
        reasoning: '需要查文件',
        toolCalls: [{ id: 'call_1', name: 'read_file', args: { path: 'a.ts' } }],
      },
    ];
    const out = p.exposeToOpenAIMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      role: 'assistant',
      content: null,
      reasoning_content: '需要查文件',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: JSON.stringify({ path: 'a.ts' }) },
        },
      ],
    });
  });

  it('assistant 不含 reasoning → 出站消息不含 reasoning_content 字段', () => {
    const p = new TestableDeepSeekProvider({ ...VALID, thinking: true });
    const msgs: ChatMessage[] = [{ role: 'assistant', content: '回答' }];
    const out = p.exposeToOpenAIMessages(msgs);
    expect(out[0]).toEqual({ role: 'assistant', content: '回答' });
    expect('reasoning_content' in (out[0] as object)).toBe(false);
  });

  it('assistant.reasoning 为空字符串 → 不注入 reasoning_content(等价于 truthy 才带)', () => {
    const p = new TestableDeepSeekProvider({ ...VALID, thinking: true });
    const msgs: ChatMessage[] = [{ role: 'assistant', content: '回答', reasoning: '' }];
    const out = p.exposeToOpenAIMessages(msgs);
    expect('reasoning_content' in (out[0] as object)).toBe(false);
  });

  it('user/system/tool 角色不会被注入 reasoning_content', () => {
    const p = new TestableDeepSeekProvider({ ...VALID, thinking: true });
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u' },
      { role: 'tool', content: 'r', toolCallId: 'call_1' },
    ];
    const out = p.exposeToOpenAIMessages(msgs);
    for (const m of out) {
      expect('reasoning_content' in (m as object)).toBe(false);
    }
  });

  it('Qwen 不注册 message:outgoing hook,即便 ChatMessage.reasoning 非空也不注入 reasoning_content', () => {
    const p = new TestableQwenProvider(VALID_QWEN);
    const msgs: ChatMessage[] = [
      { role: 'assistant', content: '回答', reasoning: '思考' },
    ];
    const out = p.exposeToOpenAIMessages(msgs);
    expect(out[0]).toEqual({ role: 'assistant', content: '回答' });
    expect('reasoning_content' in (out[0] as object)).toBe(false);
  });
});

describe('DeepSeekProvider · request:body hook 透传 thinking 字段', () => {
  it('thinking=true → 请求体顶层 `thinking: { type: "enabled" }`(DeepSeek 官方协议)', () => {
    const p = new TestableDeepSeekProvider({ ...VALID, thinking: true });
    const body = runHooksOnEmptyBody(p);
    expect((body as { thinking?: unknown }).thinking).toEqual({ type: 'enabled' });
  });

  it('thinking=false → 显式透传 `thinking: { type: "disabled" }`(DeepSeek 关闭思考需显式告知)', () => {
    const p = new TestableDeepSeekProvider({ ...VALID, thinking: false });
    const body = runHooksOnEmptyBody(p);
    expect((body as { thinking?: unknown }).thinking).toEqual({ type: 'disabled' });
  });

  it('未显式传 thinking → schema default `true` 生效 → 翻译为 enabled', () => {
    const cfg = { apiKey: VALID.apiKey, baseURL: VALID.baseURL, model: VALID.model };
    const p = new TestableDeepSeekProvider(cfg as never);
    const body = runHooksOnEmptyBody(p);
    expect((body as { thinking?: unknown }).thinking).toEqual({ type: 'enabled' });
  });

  it('hook 不破坏请求体的其它字段(model / messages / stream 原样保留)', () => {
    const p = new TestableDeepSeekProvider({ ...VALID, thinking: true });
    const body = runHooksOnEmptyBody(p);
    expect(body.model).toBe('m');
    expect(body.messages).toEqual([]);
    expect(body.stream).toBe(true);
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
