/**
 * 单测：PROVIDER_REGISTRY（AC-ABS-4）
 * ---------------------------------------------
 * 覆盖：
 * - registry 必须同时包含 qwen 与 deepseek 两条
 * - getProviderEntry(kind) 对未知 kind 抛错
 * - listEmbeddingCapableProviders 只返回有 embedding 能力的 Provider（即排除 DeepSeek）
 * - 每条 entry 的 createLLM / listModels / defaultConfig 形状正确
 * - 统一 `thinking: boolean` 入参 → 各 Provider 产出正确的请求体方言字段
 *   （本次抽象的核心契约：Provider 作为兼容层承担参数翻译。
 *    v0.6.0-beta.2 起从 providerOptions 改为直接的请求体扩展字段：
 *    DeepSeek → root.thinking;Qwen → extra_body.enable_thinking）
 */
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_REGISTRY,
  getProviderEntry,
  listProviderEntries,
  listEmbeddingCapableProviders,
} from '../registry';
import { QwenProvider } from '../qwen/index';
import { DeepSeekProvider } from '../deepseek/index';

/** 用于访问 protected getRequestBodyExtras 的窄接口 */
type ExtrasReader = {
  getRequestBodyExtras: (p: unknown) => Record<string, unknown> | undefined;
};

describe('PROVIDER_REGISTRY', () => {
  it('同时登记了 qwen 与 deepseek', () => {
    expect(PROVIDER_REGISTRY.qwen).toBeDefined();
    expect(PROVIDER_REGISTRY.deepseek).toBeDefined();
    expect(PROVIDER_REGISTRY.qwen.kind).toBe('qwen');
    expect(PROVIDER_REGISTRY.deepseek.kind).toBe('deepseek');
  });

  it('每条 entry 的 displayName / defaultConfig / listModels / createLLM / defaultBaseURL 都存在', () => {
    for (const entry of listProviderEntries()) {
      expect(entry.displayName).toBeTruthy();
      expect(entry.defaultConfig.kind).toBe(entry.kind);
      expect(typeof entry.createLLM).toBe('function');
      expect(typeof entry.listModels).toBe('function');
      expect(Array.isArray(entry.suggestedModels)).toBe(true);
      expect(entry.suggestedModels.length).toBeGreaterThan(0);
      // defaultBaseURL 是凭证桶里缺省时的回落值，必须是合法的 URL
      expect(entry.defaultBaseURL).toMatch(/^https?:\/\//);
      // v0.6.0-beta.2 Breaking：defaultConfig 不再持有 apiKey/baseURL
      expect(
        (entry.defaultConfig as unknown as { apiKey?: string }).apiKey,
      ).toBeUndefined();
      expect(
        (entry.defaultConfig as unknown as { baseURL?: string }).baseURL,
      ).toBeUndefined();
    }
  });

  it('DeepSeek 无 embedding 能力（embedding === null）', () => {
    expect(PROVIDER_REGISTRY.deepseek.embedding).toBeNull();
  });

  it('Qwen 有 embedding 能力（非 null）', () => {
    expect(PROVIDER_REGISTRY.qwen.embedding).not.toBeNull();
    expect(PROVIDER_REGISTRY.qwen.embedding?.kind).toBe('qwen-embedding');
    expect(typeof PROVIDER_REGISTRY.qwen.embedding?.createEmbedding).toBe('function');
  });

  it('listEmbeddingCapableProviders 排除 DeepSeek（满足 PRD §4.3 要求）', () => {
    const list = listEmbeddingCapableProviders();
    expect(list.every((e) => e.kind !== 'deepseek')).toBe(true);
    expect(list.some((e) => e.kind === 'qwen')).toBe(true);
  });

  it('DeepSeek 有 recommendedCombo 指向 qwen-embedding', () => {
    expect(PROVIDER_REGISTRY.deepseek.recommendedCombo?.embeddingKind).toBe('qwen-embedding');
  });

  it('getProviderEntry(未知 kind) 抛错', () => {
    // @ts-expect-error 故意传入非法 kind
    expect(() => getProviderEntry('openai')).toThrow(/Unknown provider kind/);
  });

  it('createLLM 成功构造 LLMProvider（Qwen）', () => {
    const llm = PROVIDER_REGISTRY.qwen.createLLM({
      kind: 'qwen',
      apiKey: 'sk-test',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      thinking: true,
    });
    expect(llm.getModelInfo().id).toBe('qwen-plus');
  });

  it('createLLM 成功构造 LLMProvider（DeepSeek）', () => {
    const llm = PROVIDER_REGISTRY.deepseek.createLLM({
      kind: 'deepseek',
      apiKey: 'sk-test',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      thinking: true,
    });
    const info = llm.getModelInfo();
    expect(info.id).toBe('deepseek-v4-pro');
    // DeepSeek 当前线上模型不强制声明 reasoning 能力；这里只做 supportsTools 断言
    expect(info.supportsTools).toBe(true);
  });
});

describe('PROVIDER_REGISTRY · 统一 thinking:boolean 入参 → Provider 翻译契约', () => {
  it('Qwen: thinking=true → extra_body.enable_thinking=true(Qwen 官方协议方言)', () => {
    const p = PROVIDER_REGISTRY.qwen.createLLM({
      kind: 'qwen',
      apiKey: 'sk-test',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      thinking: true,
    }) as unknown as QwenProvider;
    const extras = (p as unknown as ExtrasReader).getRequestBodyExtras({ messages: [] });
    expect(extras).toEqual({ extra_body: { enable_thinking: true } });
  });

  it('Qwen: thinking=false → 不透传(early return;避免给 Qwen 发没必要的 enable_thinking:false)', () => {
    const p = PROVIDER_REGISTRY.qwen.createLLM({
      kind: 'qwen',
      apiKey: 'sk-test',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      thinking: false,
    }) as unknown as QwenProvider;
    const extras = (p as unknown as ExtrasReader).getRequestBodyExtras({ messages: [] });
    expect(extras).toBeUndefined();
  });

  it('DeepSeek: thinking=true → 请求体顶层 thinking={ type:"enabled" }', () => {
    const p = PROVIDER_REGISTRY.deepseek.createLLM({
      kind: 'deepseek',
      apiKey: 'sk-test',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      thinking: true,
    }) as unknown as DeepSeekProvider;
    const extras = (p as unknown as ExtrasReader).getRequestBodyExtras({ messages: [] });
    expect(extras).toEqual({ thinking: { type: 'enabled' } });
  });

  it('DeepSeek: thinking=false → 显式透传 { type:"disabled" }(与 Qwen 不同,DeepSeek 关闭思考需显式告知)', () => {
    const p = PROVIDER_REGISTRY.deepseek.createLLM({
      kind: 'deepseek',
      apiKey: 'sk-test',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      thinking: false,
    }) as unknown as DeepSeekProvider;
    const extras = (p as unknown as ExtrasReader).getRequestBodyExtras({ messages: [] });
    expect(extras).toEqual({ thinking: { type: 'disabled' } });
  });
});
