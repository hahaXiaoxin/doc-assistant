import { describe, it, expect } from 'vitest';
import {
  STORAGE_KEYS,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_MAIN_PROVIDER_CONFIG,
  DEFAULT_AUX_PROVIDER_CONFIG,
  DEFAULT_EMBEDDING_PROVIDER_CONFIG,
  DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK,
  DEFAULT_MEMORY_SETTINGS,
  DEFAULT_PROVIDER_CREDENTIALS,
  MAX_TURNS_MIN,
  MAX_TURNS_MAX,
  clampMaxTurns,
  isUseMain,
  migrateProviderCredentials,
  resolveCredentialFor,
} from '../config';

describe('STORAGE_KEYS', () => {
  it('所有 key 全部存在且格式统一', () => {
    expect(STORAGE_KEYS.MAIN_PROVIDER_CONFIG).toBe('doc-assistant.main-provider-config');
    expect(STORAGE_KEYS.AUX_PROVIDER_CONFIG).toBe('doc-assistant.aux-provider-config');
    expect(STORAGE_KEYS.EMBEDDING_PROVIDER_CONFIG).toBe('doc-assistant.embedding-provider-config');
    expect(STORAGE_KEYS.MEMORY_SETTINGS).toBe('doc-assistant.memory-settings');
    expect(STORAGE_KEYS.CHAT_SETTINGS).toBe('doc-assistant.chat-settings');
    expect(STORAGE_KEYS.ACTIVE_PROVIDER).toBe('doc-assistant.active-provider');
    expect(STORAGE_KEYS.PROVIDER_CREDENTIALS).toBe('doc-assistant.provider-credentials');
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

describe('providerCredentials · migrateProviderCredentials', () => {
  const defaultBaseURLOf = (k: 'qwen' | 'deepseek'): string | undefined =>
    k === 'qwen'
      ? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
      : k === 'deepseek'
        ? 'https://api.deepseek.com'
        : undefined;

  it('空桶 + 老配置 main.apiKey → 迁入该 kind', () => {
    const baseURL = defaultBaseURLOf('qwen');
    const out = migrateProviderCredentials(
      undefined,
      [{ kind: 'qwen', apiKey: 'sk-qwen-xxx', ...(baseURL ? { baseURL } : {}) }],
      defaultBaseURLOf,
    );
    expect(out.qwen?.apiKey).toBe('sk-qwen-xxx');
    // baseURL 等于默认值 → 不写入桶
    expect(out.qwen?.baseURL).toBeUndefined();
  });

  it('老配置 baseURL 是用户自定义（非默认）→ 写入桶', () => {
    const out = migrateProviderCredentials(
      undefined,
      [{ kind: 'qwen', apiKey: 'sk', baseURL: 'https://my-proxy.example.com/v1' }],
      defaultBaseURLOf,
    );
    expect(out.qwen?.baseURL).toBe('https://my-proxy.example.com/v1');
  });

  it('桶内已有 apiKey → 不覆盖（幂等保护用户新值）', () => {
    const existing = { qwen: { apiKey: 'user-typed-new' } };
    const out = migrateProviderCredentials(
      existing,
      [{ kind: 'qwen', apiKey: 'old-legacy-key' }],
      defaultBaseURLOf,
    );
    expect(out.qwen?.apiKey).toBe('user-typed-new');
    // 没有变化时可直接返回原引用（短路）
    expect(out).toBe(existing);
  });

  it('幂等：多次运行结果一致', () => {
    const legacy = [{ kind: 'deepseek' as const, apiKey: 'sk-ds' }];
    const pass1 = migrateProviderCredentials(undefined, legacy, defaultBaseURLOf);
    const pass2 = migrateProviderCredentials(pass1, legacy, defaultBaseURLOf);
    expect(pass2).toEqual(pass1);
  });

  it('老 apiKey 为空串 → 不写入', () => {
    const out = migrateProviderCredentials(
      undefined,
      [{ kind: 'qwen', apiKey: '' }],
      defaultBaseURLOf,
    );
    expect(out.qwen).toBeUndefined();
  });

  it('多套 kind 并存（main=qwen, aux=deepseek）→ 各自入桶', () => {
    const out = migrateProviderCredentials(
      undefined,
      [
        { kind: 'qwen', apiKey: 'sk-q' },
        { kind: 'deepseek', apiKey: 'sk-d' },
      ],
      defaultBaseURLOf,
    );
    expect(out.qwen?.apiKey).toBe('sk-q');
    expect(out.deepseek?.apiKey).toBe('sk-d');
  });

  it('DEFAULT_PROVIDER_CREDENTIALS 为空对象', () => {
    expect(DEFAULT_PROVIDER_CREDENTIALS).toEqual({});
  });
});

describe('providerCredentials · resolveCredentialFor', () => {
  it('桶里有 apiKey → 用桶里的', () => {
    const resolved = resolveCredentialFor(
      { qwen: { apiKey: 'sk-bucket' } },
      'qwen',
      { apiKey: 'sk-fallback', baseURL: 'https://default' },
    );
    expect(resolved.apiKey).toBe('sk-bucket');
    expect(resolved.baseURL).toBe('https://default');
  });

  it('桶里没有 → 回落到 fallback', () => {
    const resolved = resolveCredentialFor(undefined, 'qwen', {
      apiKey: 'sk-fallback',
      baseURL: 'https://default',
    });
    expect(resolved.apiKey).toBe('sk-fallback');
  });

  it('桶里 apiKey 为空串 → 回落到 fallback', () => {
    const resolved = resolveCredentialFor(
      { qwen: { apiKey: '   ' } },
      'qwen',
      { apiKey: 'sk-fallback', baseURL: 'https://default' },
    );
    expect(resolved.apiKey).toBe('sk-fallback');
  });

  it('桶里有 baseURL 非空 → 用桶里的', () => {
    const resolved = resolveCredentialFor(
      { qwen: { apiKey: 'sk', baseURL: 'https://proxy' } },
      'qwen',
      { apiKey: 'sk-fallback', baseURL: 'https://default' },
    );
    expect(resolved.baseURL).toBe('https://proxy');
  });
});
