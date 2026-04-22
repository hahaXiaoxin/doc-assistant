import { describe, it, expect } from 'vitest';
import {
  STORAGE_KEYS,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_MAIN_PROVIDER_CONFIG,
  DEFAULT_AUX_PROVIDER_CONFIG,
  DEFAULT_EMBEDDING_PROVIDER_CONFIG,
  DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK,
  DEFAULT_MEMORY_SETTINGS,
  DEFAULT_QWEN_CONFIG,
  MAX_TURNS_MIN,
  MAX_TURNS_MAX,
  clampMaxTurns,
  isUseMain,
  migrateQwenConfigToMain,
} from '../config';

describe('STORAGE_KEYS', () => {
  it('新旧 key 全部存在且格式统一', () => {
    expect(STORAGE_KEYS.QWEN_CONFIG).toBe('doc-assistant.qwen-config');
    expect(STORAGE_KEYS.MAIN_PROVIDER_CONFIG).toBe('doc-assistant.main-provider-config');
    expect(STORAGE_KEYS.AUX_PROVIDER_CONFIG).toBe('doc-assistant.aux-provider-config');
    expect(STORAGE_KEYS.EMBEDDING_PROVIDER_CONFIG).toBe('doc-assistant.embedding-provider-config');
    expect(STORAGE_KEYS.MEMORY_SETTINGS).toBe('doc-assistant.memory-settings');
    expect(STORAGE_KEYS.CHAT_SETTINGS).toBe('doc-assistant.chat-settings');
    expect(STORAGE_KEYS.ACTIVE_PROVIDER).toBe('doc-assistant.active-provider');
  });

  it('所有 key 都以 doc-assistant. 开头，避免与宿主页面 storage 冲突（chrome.storage.local 无冲突但保持约定）', () => {
    for (const v of Object.values(STORAGE_KEYS)) {
      expect(v.startsWith('doc-assistant.')).toBe(true);
    }
  });
});

describe('DEFAULT_* 默认值', () => {
  it('主 Provider 默认指向 dashscope OpenAI 兼容端点', () => {
    expect(DEFAULT_MAIN_PROVIDER_CONFIG.kind).toBe('qwen');
    expect(DEFAULT_MAIN_PROVIDER_CONFIG.baseURL).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    );
    expect(DEFAULT_MAIN_PROVIDER_CONFIG.model).toBe('qwen-plus');
    expect(DEFAULT_MAIN_PROVIDER_CONFIG.apiKey).toBe('');
    expect(DEFAULT_MAIN_PROVIDER_CONFIG.enableThinking).toBe(true);
  });

  it('辅助 Provider 默认 useMain=true', () => {
    expect(isUseMain(DEFAULT_AUX_PROVIDER_CONFIG)).toBe(true);
  });

  it('Embedding Provider 默认 useMain=true', () => {
    expect(isUseMain(DEFAULT_EMBEDDING_PROVIDER_CONFIG)).toBe(true);
  });

  it('Embedding fallback 指向 text-embedding-v2（1536 维）', () => {
    expect(DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK.kind).toBe('qwen-embedding');
    expect(DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK.model).toBe('text-embedding-v2');
    expect(DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK.dimension).toBe(1536);
  });

  it('MemorySettings 默认：过滤开 / 反思开 / 30 天 TTL / 3 次自动确认', () => {
    expect(DEFAULT_MEMORY_SETTINGS.sensitiveFilterEnabled).toBe(true);
    expect(DEFAULT_MEMORY_SETTINGS.reflectionEnabled).toBe(true);
    expect(DEFAULT_MEMORY_SETTINGS.workingMemoryTtlDays).toBe(30);
    expect(DEFAULT_MEMORY_SETTINGS.personaAutoConfirmHits).toBe(3);
  });

  it('ChatSettings 默认 maxTurns=8，在合法范围内', () => {
    expect(DEFAULT_CHAT_SETTINGS.maxTurns).toBe(8);
    expect(DEFAULT_CHAT_SETTINGS.maxTurns).toBeGreaterThanOrEqual(MAX_TURNS_MIN);
    expect(DEFAULT_CHAT_SETTINGS.maxTurns).toBeLessThanOrEqual(MAX_TURNS_MAX);
  });
});

describe('isUseMain', () => {
  it('识别 useMain 标记', () => {
    expect(isUseMain({ useMain: true })).toBe(true);
  });

  it('完整 provider config 返回 false', () => {
    expect(
      isUseMain({
        kind: 'qwen',
        baseURL: 'x',
        model: 'y',
        apiKey: 'z',
      }),
    ).toBe(false);
  });

  it('undefined 返回 false', () => {
    expect(isUseMain(undefined)).toBe(false);
  });
});

describe('clampMaxTurns', () => {
  it('正常范围原样返回', () => {
    expect(clampMaxTurns(8)).toBe(8);
    expect(clampMaxTurns(3)).toBe(3);
    expect(clampMaxTurns(15)).toBe(15);
  });

  it('低于下限夹到 MIN', () => {
    expect(clampMaxTurns(0)).toBe(MAX_TURNS_MIN);
    expect(clampMaxTurns(-5)).toBe(MAX_TURNS_MIN);
  });

  it('高于上限夹到 MAX', () => {
    expect(clampMaxTurns(99)).toBe(MAX_TURNS_MAX);
  });

  it('非法输入回退到默认', () => {
    expect(clampMaxTurns(undefined)).toBe(DEFAULT_CHAT_SETTINGS.maxTurns);
    expect(clampMaxTurns(NaN)).toBe(DEFAULT_CHAT_SETTINGS.maxTurns);
    expect(clampMaxTurns('abc')).toBe(DEFAULT_CHAT_SETTINGS.maxTurns);
    expect(clampMaxTurns(null)).toBe(DEFAULT_CHAT_SETTINGS.maxTurns);
  });

  it('小数向下取整', () => {
    expect(clampMaxTurns(8.9)).toBe(8);
  });
});

describe('migrateQwenConfigToMain', () => {
  it('v0.1 QwenConfig 无损迁移为 v0.2 LLMProviderConfig', () => {
    const old = {
      apiKey: 'sk-old-key',
      baseURL: 'https://custom.example.com/v1',
      model: 'qwen-max',
      enableThinking: false,
    };
    const migrated = migrateQwenConfigToMain(old);
    expect(migrated).toEqual({
      kind: 'qwen',
      apiKey: 'sk-old-key',
      baseURL: 'https://custom.example.com/v1',
      model: 'qwen-max',
      enableThinking: false,
    });
  });

  it('DEFAULT_QWEN_CONFIG 迁移后 kind=qwen', () => {
    const migrated = migrateQwenConfigToMain(DEFAULT_QWEN_CONFIG);
    expect(migrated.kind).toBe('qwen');
    expect(migrated.model).toBe(DEFAULT_QWEN_CONFIG.model);
  });
});
