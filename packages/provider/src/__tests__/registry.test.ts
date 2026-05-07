/**
 * 单测：PROVIDER_REGISTRY（AC-ABS-4）
 * ---------------------------------------------
 * 覆盖：
 * - registry 必须同时包含 qwen 与 deepseek 两条
 * - getProviderEntry(kind) 对未知 kind 抛错
 * - listEmbeddingCapableProviders 只返回有 embedding 能力的 Provider（即排除 DeepSeek）
 * - 每条 entry 的 createLLM / listModels / defaultConfig 形状正确
 */
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_REGISTRY,
  getProviderEntry,
  listProviderEntries,
  listEmbeddingCapableProviders,
} from '../registry';

describe('PROVIDER_REGISTRY', () => {
  it('同时登记了 qwen 与 deepseek', () => {
    expect(PROVIDER_REGISTRY.qwen).toBeDefined();
    expect(PROVIDER_REGISTRY.deepseek).toBeDefined();
    expect(PROVIDER_REGISTRY.qwen.kind).toBe('qwen');
    expect(PROVIDER_REGISTRY.deepseek.kind).toBe('deepseek');
  });

  it('每条 entry 的 displayName / defaultConfig / listModels / createLLM 都存在', () => {
    for (const entry of listProviderEntries()) {
      expect(entry.displayName).toBeTruthy();
      expect(entry.defaultConfig.kind).toBe(entry.kind);
      expect(typeof entry.createLLM).toBe('function');
      expect(typeof entry.listModels).toBe('function');
      expect(Array.isArray(entry.suggestedModels)).toBe(true);
      expect(entry.suggestedModels.length).toBeGreaterThan(0);
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
      enableThinking: true,
    });
    expect(llm.getModelInfo().id).toBe('qwen-plus');
  });

  it('createLLM 成功构造 LLMProvider（DeepSeek）', () => {
    const llm = PROVIDER_REGISTRY.deepseek.createLLM({
      kind: 'deepseek',
      apiKey: 'sk-test',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
    });
    const info = llm.getModelInfo();
    expect(info.id).toBe('deepseek-v4-pro');
    // DeepSeek 当前线上模型不强制声明 reasoning 能力；这里只做 supportsTools 断言
    expect(info.supportsTools).toBe(true);
  });
});
