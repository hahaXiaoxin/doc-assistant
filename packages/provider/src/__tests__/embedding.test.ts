/**
 * 单测：QwenEmbeddingProvider
 * ---------------------------------------------
 * 覆盖：
 * - 构造期配置校验（invalid → ProviderError）
 * - 空数组直接返回 []
 * - 单批请求 → 返回正确向量
 * - 多批（> maxBatchSize=25）自动分批
 * - HTTP 非 2xx → ProviderError
 * - 响应结构非法 → ProviderError
 * - 维度不一致 → ProviderError
 * - 返回数量不匹配 → ProviderError
 * - AbortError 透传为 ABORTED
 * - maskSecret 日志脱敏（通过日志捕获）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QwenEmbeddingProvider } from '../qwen/embedding';
import { ProviderError } from '@doc-assistant/shared';

const VALID_CONFIG = {
  apiKey: 'sk-test-key-123456789',
  baseURL: 'https://example.com/v1',
  model: 'text-embedding-v2',
  dimension: 1536,
};

function mockFetchOk(vectors: number[][]) {
  const payload = {
    data: vectors.map((v, i) => ({ index: i, embedding: v })),
    usage: { prompt_tokens: 10, total_tokens: 10 },
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

describe('QwenEmbeddingProvider · 构造期校验', () => {
  it('invalid config 抛 ProviderError(INVALID_CONFIG)', () => {
    expect(() => new QwenEmbeddingProvider({ apiKey: '', baseURL: 'x', model: '', dimension: 0 })).toThrow(
      ProviderError,
    );
  });

  it('合法 config 正常初始化且 info 维度正确', () => {
    const p = new QwenEmbeddingProvider(VALID_CONFIG);
    const info = p.getEmbeddingInfo();
    expect(info.id).toBe('text-embedding-v2');
    expect(info.dimension).toBe(1536);
    expect(info.maxBatchSize).toBe(25);
  });

  it('v3 模型维度自动取 1024', () => {
    const p = new QwenEmbeddingProvider({
      ...VALID_CONFIG,
      model: 'text-embedding-v3',
      dimension: 1024,
    });
    expect(p.getEmbeddingInfo().dimension).toBe(1024);
  });

  it('声明的 dimension 与能力表不符时仍以能力表为准（打警告）', () => {
    const p = new QwenEmbeddingProvider({
      ...VALID_CONFIG,
      model: 'text-embedding-v2',
      dimension: 9999, // 错的
    });
    expect(p.getEmbeddingInfo().dimension).toBe(1536); // 以能力表为准
  });
});

describe('QwenEmbeddingProvider · embed 行为', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('空数组直接返回 []', async () => {
    const p = new QwenEmbeddingProvider(VALID_CONFIG);
    globalThis.fetch = mockFetchOk([]) as typeof globalThis.fetch;
    const out = await p.embed([]);
    expect(out).toEqual([]);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('单批请求返回对应数量的 Float32Array，值逐一对齐', async () => {
    const p = new QwenEmbeddingProvider(VALID_CONFIG);
    // 构造 1536 维向量
    const v1 = new Array(1536).fill(0.1);
    const v2 = new Array(1536).fill(0.2);
    globalThis.fetch = mockFetchOk([v1, v2]) as typeof globalThis.fetch;
    const out = await p.embed(['hello', 'world']);
    expect(out.length).toBe(2);
    expect(out[0]).toBeInstanceOf(Float32Array);
    expect(out[0]!.length).toBe(1536);
    expect(out[0]![0]).toBeCloseTo(0.1, 5);
    expect(out[1]![0]).toBeCloseTo(0.2, 5);
  });

  it('响应乱序时按 index 重新排序', async () => {
    const p = new QwenEmbeddingProvider(VALID_CONFIG);
    const v0 = new Array(1536).fill(0.5);
    const v1 = new Array(1536).fill(0.7);
    const payload = {
      data: [
        { index: 1, embedding: v1 },
        { index: 0, embedding: v0 },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
      async text() {
        return '';
      },
    } as unknown as Response) as typeof globalThis.fetch;
    const out = await p.embed(['a', 'b']);
    expect(out[0]![0]).toBeCloseTo(0.5, 5);
    expect(out[1]![0]).toBeCloseTo(0.7, 5);
  });

  it('>25 条时自动分批（调用 fetch 2 次）', async () => {
    const p = new QwenEmbeddingProvider(VALID_CONFIG);
    // 模拟 fetch 每次返回与 input 数量一致
    const dim = 1536;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const inputCount = (body.input as string[]).length;
      const data = Array.from({ length: inputCount }, (_, i) => ({
        index: i,
        embedding: new Array(dim).fill(0.01 * i),
      }));
      return {
        ok: true,
        status: 200,
        async json() {
          return { data };
        },
        async text() {
          return '';
        },
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const texts = Array.from({ length: 27 }, (_, i) => `text-${i}`);
    const out = await p.embed(texts);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 第一批 25 条
    expect((JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).input as string[]).length).toBe(25);
    // 第二批 2 条
    expect((JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).input as string[]).length).toBe(2);
    expect(out.length).toBe(27);
  });

  it('HTTP 非 2xx 抛 ProviderError(EMBEDDING_HTTP_ERROR)', async () => {
    const p = new QwenEmbeddingProvider(VALID_CONFIG);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      async json() {
        return {};
      },
      async text() {
        return 'invalid api key';
      },
    } as unknown as Response) as typeof globalThis.fetch;
    await expect(p.embed(['x'])).rejects.toThrow(ProviderError);
    await expect(p.embed(['x'])).rejects.toThrow(/401/);
  });

  it('响应结构非法抛 ProviderError(EMBEDDING_SCHEMA_ERROR)', async () => {
    const p = new QwenEmbeddingProvider(VALID_CONFIG);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      async json() {
        return { wrong: 'structure' };
      },
      async text() {
        return '';
      },
    } as unknown as Response) as typeof globalThis.fetch;
    await expect(p.embed(['x'])).rejects.toThrow(ProviderError);
  });

  it('返回向量维度与声明不一致时抛 ProviderError(EMBEDDING_DIMENSION_MISMATCH)', async () => {
    const p = new QwenEmbeddingProvider(VALID_CONFIG);
    globalThis.fetch = mockFetchOk([new Array(512).fill(0.1)]) as typeof globalThis.fetch;
    await expect(p.embed(['x'])).rejects.toThrow(/DIMENSION_MISMATCH|维度/);
  });

  it('返回条数少于输入时抛 ProviderError(EMBEDDING_COUNT_MISMATCH)', async () => {
    const p = new QwenEmbeddingProvider(VALID_CONFIG);
    globalThis.fetch = mockFetchOk([new Array(1536).fill(0.1)]) as typeof globalThis.fetch;
    await expect(p.embed(['x', 'y'])).rejects.toThrow(/请求.*返回/);
  });

  it('AbortError 转为 ProviderError(ABORTED)', async () => {
    const p = new QwenEmbeddingProvider(VALID_CONFIG);
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      return Promise.reject(e);
    }) as typeof globalThis.fetch;
    try {
      await p.embed(['x']);
      expect.fail('应抛 ProviderError');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe('ABORTED');
    }
  });

  it('网络错误转为 ProviderError(NETWORK_ERROR)', async () => {
    const p = new QwenEmbeddingProvider(VALID_CONFIG);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('DNS resolution failed')) as typeof globalThis.fetch;
    try {
      await p.embed(['x']);
      expect.fail('应抛 ProviderError');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe('NETWORK_ERROR');
    }
  });

  it('joinUrl 处理 baseURL 结尾斜杠', async () => {
    const p = new QwenEmbeddingProvider({ ...VALID_CONFIG, baseURL: 'https://example.com/v1/' });
    const fetchMock = mockFetchOk([new Array(1536).fill(0.1)]);
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    await p.embed(['x']);
    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toBe('https://example.com/v1/embeddings');
  });
});

describe('QwenEmbeddingProvider · 日志脱敏', () => {
  it('构造时日志不应包含完整 apiKey', () => {
    // 通过劫持 console.info 观察日志
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    new QwenEmbeddingProvider({
      apiKey: 'sk-super-secret-key-abcdefghij1234567890',
      baseURL: 'https://example.com/v1',
      model: 'text-embedding-v2',
      dimension: 1536,
    });
    // 所有 info 调用的参数拼接后不应出现完整 apiKey
    const allArgs = infoSpy.mock.calls.flat().map((a) => JSON.stringify(a));
    const joined = allArgs.join(' ');
    expect(joined).not.toContain('sk-super-secret-key-abcdefghij1234567890');
    // 但应包含 maskSecret 形态：sk-s****7890 或类似
    expect(joined).toMatch(/sk-s[^"']*\*{4}/);
    infoSpy.mockRestore();
  });
});
