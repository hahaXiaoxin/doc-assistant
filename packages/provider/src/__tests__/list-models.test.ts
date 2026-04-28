/**
 * 单测：listQwenModels + classifyQwenModel
 * ---------------------------------------------
 * 覆盖：
 * - classifyQwenModel 按前缀分类的边界
 * - 入参校验（空 apiKey / 空 baseURL → INVALID_CONFIG）
 * - 正常响应：解析、去重、按 kind+id 排序
 * - 能力表命中时 capability 填充（仅 chat）
 * - HTTP 非 2xx → LIST_MODELS_HTTP_ERROR
 * - 响应非 JSON → LIST_MODELS_PARSE_ERROR
 * - 响应结构非法 → LIST_MODELS_SCHEMA_ERROR
 * - 网络错误 → NETWORK_ERROR
 * - AbortError → ABORTED
 * - URL 拼接：baseURL 结尾斜杠
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@doc-assistant/shared';
import {
  classifyQwenModel,
  listQwenModels,
  type QwenModelListItem,
} from '../qwen/list-models';

const VALID = {
  apiKey: 'sk-test-key-abcdefghij',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
};

function mockFetchOk(ids: Array<string | { id: string; owned_by?: string }>) {
  const payload = {
    object: 'list',
    data: ids.map((x) =>
      typeof x === 'string'
        ? { id: x, object: 'model', created: 1, owned_by: 'system' }
        : { id: x.id, object: 'model', created: 1, owned_by: x.owned_by ?? 'system' },
    ),
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

describe('classifyQwenModel', () => {
  it.each([
    // ---- chat：常见千问系列 ----
    ['qwen-plus', 'chat'],
    ['qwen-max', 'chat'],
    ['qwen-turbo', 'chat'],
    ['qwen-long', 'chat'],
    ['qwen3-max', 'chat'],
    ['qwen2.5-7b-instruct', 'chat'],
    ['qwen-coder-plus', 'chat'],
    ['qwen-coder-turbo-latest', 'chat'],
    ['qwen-math-plus', 'chat'],
    ['qwen-omni-turbo', 'chat'], // 全模态但能走 chat
    ['qwq-32b-preview', 'chat'],
    // ---- chat：其它厂商 ----
    ['deepseek-r1', 'chat'],
    ['deepseek-v3', 'chat'],
    ['llama3.1-70b-instruct', 'chat'],
    ['baichuan2-turbo', 'chat'],
    ['chatglm3-6b', 'chat'],
    ['yi-large', 'chat'],
    ['moonshot-v1-8k', 'chat'],
    ['farui-plus', 'chat'], // 法睿（DashScope 常见）
    ['abab6.5-chat', 'chat'],
    ['internlm2.5-7b-chat', 'chat'],
    // ---- chat：默认兜底（未知模型也视作 chat） ----
    ['something-else', 'chat'],
    ['my-finetuned-model', 'chat'],
    ['unknown-vendor-1', 'chat'],
    // ---- embedding ----
    ['text-embedding-v2', 'embedding'],
    ['text-embedding-v3', 'embedding'],
    ['text-embedding-async-v2', 'embedding'],
    ['bge-large-zh-v1.5', 'embedding'],
    ['gte-large-zh', 'embedding'],
    // ---- rerank（优先级高于 embedding：gte- 开头含 rerank 归 rerank） ----
    ['gte-rerank', 'rerank'],
    ['gte-rerank-v2', 'rerank'],
    // ---- vision ----
    ['qwen-vl-plus', 'vision'],
    ['qwen-vl-max', 'vision'],
    ['qwen2-vl-7b-instruct', 'vision'],
    ['qwen2.5-vl-72b-instruct', 'vision'],
    ['qvq-72b-preview', 'vision'],
    // ---- audio ----
    ['qwen-audio-turbo', 'audio'],
    ['qwen2-audio-instruct', 'audio'],
    ['paraformer-v2', 'audio'],
    ['sensevoice-v1', 'audio'],
    ['cosyvoice-v1', 'audio'],
    ['sambert-zhichu-v1', 'audio'],
    // ---- image ----
    ['wanx-v1', 'image'],
    ['wanx2.1-t2i-turbo', 'image'],
    ['flux-dev', 'image'],
    ['flux-schnell', 'image'],
    ['stable-diffusion-xl', 'image'],
    ['sd-3.5', 'image'],
  ])('%s → %s', (id, expected) => {
    expect(classifyQwenModel(id)).toBe(expected);
  });
});

describe('listQwenModels · 参数校验', () => {
  it('apiKey 为空 → INVALID_CONFIG', async () => {
    await expect(listQwenModels({ apiKey: '', baseURL: VALID.baseURL })).rejects.toThrow(
      ProviderError,
    );
  });

  it('baseURL 为空 → INVALID_CONFIG', async () => {
    await expect(listQwenModels({ apiKey: VALID.apiKey, baseURL: '' })).rejects.toThrow(
      ProviderError,
    );
  });
});

describe('listQwenModels · 正常路径', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('解析 + 分类 + 排序：chat 先 / embedding 次 / 其他在后，组内字典序', async () => {
    const fetchMock = mockFetchOk([
      'text-embedding-v2',
      'qwen-plus',
      'qwen-vl-plus',
      'qwen-max',
      'gte-rerank',
    ]);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await listQwenModels(VALID);
    expect(result.map((r) => r.id)).toEqual([
      'qwen-max',
      'qwen-plus',
      'text-embedding-v2',
      'gte-rerank',
      'qwen-vl-plus',
    ]);
  });

  it('chat 类模型命中能力表 → capability 填充；未命中则 undefined', async () => {
    globalThis.fetch = mockFetchOk([
      'qwen-plus', // 命中
      'qwen-turbo', // 命中
      'qwen2.5-7b-instruct', // 未命中
    ]) as unknown as typeof globalThis.fetch;

    const result = await listQwenModels(VALID);
    const byId = Object.fromEntries(result.map((r) => [r.id, r]));
    expect(byId['qwen-plus']?.capability?.contextWindow).toBe(131072);
    expect(byId['qwen-turbo']?.capability?.supportsTools).toBe(true);
    expect(byId['qwen2.5-7b-instruct']?.capability).toBeUndefined();
  });

  it('embedding 模型即使在 QWEN_MODEL_CAPABILITIES 表里出现也不填 capability（表只面向 chat）', async () => {
    globalThis.fetch = mockFetchOk(['text-embedding-v2']) as unknown as typeof globalThis.fetch;
    const result = await listQwenModels(VALID);
    expect(result[0]?.kind).toBe('embedding');
    expect(result[0]?.capability).toBeUndefined();
  });

  it('去重：相同 id 只保留一条', async () => {
    globalThis.fetch = mockFetchOk([
      'qwen-plus',
      'qwen-plus',
      'qwen-max',
    ]) as unknown as typeof globalThis.fetch;
    const result = await listQwenModels(VALID);
    expect(result.length).toBe(2);
  });

  it('透传 owned_by', async () => {
    globalThis.fetch = mockFetchOk([
      { id: 'qwen-plus', owned_by: 'system' },
      { id: 'my-finetune', owned_by: 'user-123' },
    ]) as unknown as typeof globalThis.fetch;
    const result = await listQwenModels(VALID);
    const byId = Object.fromEntries(result.map((r) => [r.id, r]));
    expect(byId['qwen-plus']?.ownedBy).toBe('system');
    expect(byId['my-finetune']?.ownedBy).toBe('user-123');
  });

  it('请求 URL 为 {baseURL}/models，带 Authorization header', async () => {
    const fetchMock = mockFetchOk(['qwen-plus']);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await listQwenModels(VALID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
    );
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${VALID.apiKey}`,
    });
  });

  it('baseURL 结尾斜杠不会产生双斜杠', async () => {
    const fetchMock = mockFetchOk(['qwen-plus']);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await listQwenModels({ ...VALID, baseURL: `${VALID.baseURL}/` });

    const [calledUrl] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
    );
  });
});

describe('listQwenModels · 异常路径', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('HTTP 401 → LIST_MODELS_HTTP_ERROR', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      async text() {
        return 'invalid api key';
      },
    } as unknown as Response) as unknown as typeof globalThis.fetch;

    await expect(listQwenModels(VALID)).rejects.toMatchObject({
      code: 'LIST_MODELS_HTTP_ERROR',
    });
  });

  it('响应非 JSON → LIST_MODELS_PARSE_ERROR', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      async json() {
        throw new SyntaxError('bad json');
      },
    } as unknown as Response) as unknown as typeof globalThis.fetch;

    await expect(listQwenModels(VALID)).rejects.toMatchObject({
      code: 'LIST_MODELS_PARSE_ERROR',
    });
  });

  it('响应结构非法（缺 data 字段） → LIST_MODELS_SCHEMA_ERROR', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      async json() {
        return { object: 'list' }; // 没有 data
      },
    } as unknown as Response) as unknown as typeof globalThis.fetch;

    await expect(listQwenModels(VALID)).rejects.toMatchObject({
      code: 'LIST_MODELS_SCHEMA_ERROR',
    });
  });

  it('fetch 抛普通错误 → NETWORK_ERROR', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof globalThis.fetch;

    await expect(listQwenModels(VALID)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('AbortError → ABORTED', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(abortErr) as unknown as typeof globalThis.fetch;

    await expect(listQwenModels(VALID)).rejects.toMatchObject({
      code: 'ABORTED',
    });
  });
});

describe('listQwenModels · 类型守卫', () => {
  it('返回对象满足 QwenModelListItem 类型', async () => {
    globalThis.fetch = mockFetchOk(['qwen-plus']) as unknown as typeof globalThis.fetch;
    const result = await listQwenModels(VALID);
    const first: QwenModelListItem | undefined = result[0];
    expect(first?.id).toBe('qwen-plus');
    expect(first?.kind).toBe('chat');
  });
});
