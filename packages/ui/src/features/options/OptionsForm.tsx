/**
 * OptionsForm · Tabs 容器（v0.2 重构）
 * ---------------------------------------------
 * 职责：
 * - 加载 STORAGE_KEYS
 * - 将各段配置（main / aux / embedding / chat / memorySettings）分发给对应 Tab
 * - 统一的 Save / Reset 底部吸附栏
 *
 * v0.6.0-beta.2：
 * - zod schema 改为 `z.discriminatedUnion('kind', [...])`，每个 registry kind
 *   一个子 schema，消除硬编码 `kind: z.literal('qwen')`
 * - 保存前软校验：main=DeepSeek + embedding useMain=true 时弹 Modal.confirm
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Space, Tabs, Typography, message } from 'antd';
import {
  DEFAULT_AUX_PROVIDER_CONFIG,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_EMBEDDING_PROVIDER_CONFIG,
  DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK,
  DEFAULT_MAIN_PROVIDER_CONFIG,
  DEFAULT_MEMORY_SETTINGS,
  DEFAULT_PROVIDER_CREDENTIALS,
  STORAGE_KEYS,
  clampMaxTurns,
  createLogger,
  maskSecret,
  migrateProviderCredentials,
  resolveCredentialFor,
  type ChatSettings,
  type EmbeddingProviderConfig,
  type LLMProviderConfig,
  type MemorySettings,
  type ProviderConfigOrRef,
  type ProviderCredentialsMap,
  type ProviderKind,
  type StorageSchema,
  type TypedStorage,
} from '@doc-assistant/shared';
import { PROVIDER_REGISTRY } from '@doc-assistant/provider';
import { z } from 'zod';
import { BasicTab } from './tabs/BasicTab';
import { MemoryTab } from './tabs/MemoryTab';
import { MemoryBrowserTab } from './tabs/MemoryBrowserTab';
import { AdvancedTab } from './tabs/AdvancedTab';
import { DebugTab } from './tabs/DebugTab';
import type { MemoryStore } from '@doc-assistant/memory';

const logger = createLogger('ui:options');

/** 基础 LLM 字段（每个 kind 的子 schema 在此之上扩展 discriminator） */
const baseLLMSchemaShape = {
  apiKey: z.string().trim().min(1, '请填写主 Provider 的 API Key'),
  baseURL: z.string().trim().url('主 Provider 的 Base URL 不合法'),
  model: z.string().trim().min(1, '请选择主 Provider 模型'),
  enableThinking: z.boolean().optional(),
};

const qwenMainSchema = z.object({
  kind: z.literal('qwen'),
  ...baseLLMSchemaShape,
});

const deepseekMainSchema = z.object({
  kind: z.literal('deepseek'),
  ...baseLLMSchemaShape,
});

const mainProviderSchema = z.discriminatedUnion('kind', [qwenMainSchema, deepseekMainSchema]);

const auxLLMSchemaShape = {
  apiKey: z.string().trim().min(1, '辅助 Provider 的 API Key 不能为空'),
  baseURL: z.string().trim().url(),
  model: z.string().trim().min(1),
  enableThinking: z.boolean().optional(),
};

const llmProviderOrRefSchema = z.union([
  z.object({ useMain: z.literal(true) }),
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('qwen'), ...auxLLMSchemaShape }),
    z.object({ kind: z.literal('deepseek'), ...auxLLMSchemaShape }),
  ]),
]);

const embeddingProviderOrRefSchema = z.union([
  z.object({ useMain: z.literal(true) }),
  z.object({
    kind: z.literal('qwen-embedding'),
    apiKey: z.string().trim().min(1, 'Embedding Provider 的 API Key 不能为空'),
    baseURL: z.string().trim().url(),
    model: z.string().trim().min(1),
    dimension: z.number().int().positive(),
  }),
]);

const chatSettingsSchema = z.object({
  systemPrompt: z.string().trim().min(1, '系统提示词不能为空'),
  maxContextChars: z.number().int().min(1000).max(32000),
  maxTurns: z.number().int().min(3).max(15),
});

const memorySettingsSchema = z.object({
  sensitiveFilterEnabled: z.boolean(),
  reflectionEnabled: z.boolean(),
  workingMemoryTtlDays: z.number().int().min(1).max(365),
  personaAutoConfirmHits: z.number().int().min(1).max(10),
});

export interface OptionsFormProps {
  storage: TypedStorage<StorageSchema>;
  /** v0.4.0：记忆浏览器 Tab 的数据源；为 null 时该 Tab 显示占位文案 */
  memory?: MemoryStore | null;
}

function isUseMainRef(v: unknown): boolean {
  return !!v && typeof v === 'object' && (v as { useMain?: boolean }).useMain === true;
}

export function OptionsForm({ storage, memory = null }: OptionsFormProps) {
  const [main, setMain] = useState<LLMProviderConfig>(DEFAULT_MAIN_PROVIDER_CONFIG);
  const [aux, setAux] =
    useState<ProviderConfigOrRef<LLMProviderConfig>>(DEFAULT_AUX_PROVIDER_CONFIG);
  const [embedding, setEmbedding] =
    useState<ProviderConfigOrRef<EmbeddingProviderConfig>>(DEFAULT_EMBEDDING_PROVIDER_CONFIG);
  const [chat, setChat] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [memorySettings, setMemorySettings] = useState<MemorySettings>(DEFAULT_MEMORY_SETTINGS);

  /**
   * v0.6.0-beta.2：按 Provider 分桶的凭证（apiKey + 可选 baseURL）
   * - 加载时：读取桶；若为空则从旧 main/aux 字段迁移
   * - UI 交互：BasicTab / ProviderConfigForm 的 apiKey/baseURL 输入框透过
   *   useMainProvider 的读写接口直接访问桶；main/aux/embedding 里残留的
   *   apiKey/baseURL 字段仅作"旧版本向后兼容"
   * - 保存时：桶与 main/aux/embedding 同步写回
   */
  const [credentials, setCredentials] = useState<ProviderCredentialsMap>(
    DEFAULT_PROVIDER_CREDENTIALS,
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, modalContextHolder] = Modal.useModal();

  const keyMask = useMemo(() => maskSecret(main.apiKey), [main.apiKey]);

  useEffect(() => {
    void (async () => {
      const [mainStored, auxStored, embStored, credsStored, chatStored, memStored] =
        await Promise.all([
          storage.get(STORAGE_KEYS.MAIN_PROVIDER_CONFIG),
          storage.get(STORAGE_KEYS.AUX_PROVIDER_CONFIG),
          storage.get(STORAGE_KEYS.EMBEDDING_PROVIDER_CONFIG),
          storage.get(STORAGE_KEYS.PROVIDER_CREDENTIALS),
          storage.get(STORAGE_KEYS.CHAT_SETTINGS),
          storage.get(STORAGE_KEYS.MEMORY_SETTINGS),
        ]);

      // 先收集旧字段以便迁移
      const defaultBaseURLOf = (k: ProviderKind): string | undefined =>
        PROVIDER_REGISTRY[k]?.defaultConfig.baseURL;
      const legacyForMigration: Array<
        { kind: ProviderKind; apiKey?: string; baseURL?: string } | undefined
      > = [
        mainStored
          ? {
              kind: mainStored.kind ?? DEFAULT_MAIN_PROVIDER_CONFIG.kind,
              apiKey: mainStored.apiKey,
              baseURL: mainStored.baseURL,
            }
          : undefined,
        auxStored && !(auxStored as { useMain?: boolean }).useMain
          ? {
              kind: (auxStored as LLMProviderConfig).kind,
              apiKey: (auxStored as LLMProviderConfig).apiKey,
              baseURL: (auxStored as LLMProviderConfig).baseURL,
            }
          : undefined,
      ];
      const migrated = migrateProviderCredentials(
        credsStored ?? DEFAULT_PROVIDER_CREDENTIALS,
        legacyForMigration,
        defaultBaseURLOf,
      );
      setCredentials(migrated);
      // 桶被迁移改动了 → 立刻写回 storage，以便 offscreen/sidebar 在下次冷启动读到
      if (migrated !== (credsStored ?? DEFAULT_PROVIDER_CREDENTIALS)) {
        try {
          await storage.set(STORAGE_KEYS.PROVIDER_CREDENTIALS, migrated);
          logger.info('providerCredentials 迁移已写入', {
            kinds: Object.keys(migrated),
          });
        } catch (err) {
          logger.warn('providerCredentials 迁移写回失败', (err as Error).message);
        }
      }

      if (mainStored) {
        // 兜底：脏数据中 kind 缺失时落回 qwen（见 PRD §8 R-6）
        const kind = mainStored.kind ?? DEFAULT_MAIN_PROVIDER_CONFIG.kind;
        const normalized: LLMProviderConfig = {
          ...DEFAULT_MAIN_PROVIDER_CONFIG,
          ...mainStored,
          kind,
        };
        // 从桶里取当前 kind 的 apiKey/baseURL 覆盖显示（桶里没有就回落旧值）
        const resolved = resolveCredentialFor(migrated, kind, {
          apiKey: normalized.apiKey,
          baseURL: normalized.baseURL,
        });
        setMain({ ...normalized, apiKey: resolved.apiKey, baseURL: resolved.baseURL });
      }

      if (auxStored) {
        if ((auxStored as { useMain?: boolean }).useMain) {
          setAux(auxStored);
        } else {
          const auxCfg = auxStored as LLMProviderConfig;
          const resolved = resolveCredentialFor(migrated, auxCfg.kind, {
            apiKey: auxCfg.apiKey,
            baseURL: auxCfg.baseURL,
          });
          setAux({ ...auxCfg, apiKey: resolved.apiKey, baseURL: resolved.baseURL });
        }
      }
      if (embStored) setEmbedding(embStored);

      // ChatSettings：合并默认 + 旧值（可能缺 maxTurns）
      if (chatStored) {
        setChat({
          ...DEFAULT_CHAT_SETTINGS,
          ...chatStored,
          maxTurns: clampMaxTurns(chatStored.maxTurns ?? DEFAULT_CHAT_SETTINGS.maxTurns),
        });
      }

      if (memStored) {
        setMemorySettings({ ...DEFAULT_MEMORY_SETTINGS, ...memStored });
      }

      setLoading(false);
    })();
  }, [storage]);

  const persistAll = async () => {
    setSaving(true);
    try {
      await storage.setMany({
        [STORAGE_KEYS.ACTIVE_PROVIDER]: main.kind,
        [STORAGE_KEYS.MAIN_PROVIDER_CONFIG]: main,
        [STORAGE_KEYS.AUX_PROVIDER_CONFIG]: aux,
        [STORAGE_KEYS.EMBEDDING_PROVIDER_CONFIG]: embedding,
        [STORAGE_KEYS.PROVIDER_CREDENTIALS]: credentials,
        [STORAGE_KEYS.CHAT_SETTINGS]: chat,
        [STORAGE_KEYS.MEMORY_SETTINGS]: memorySettings,
      });
      logger.info('配置已保存', {
        provider: main.kind,
        model: main.model,
        apiKey: keyMask,
        auxUseMain: isUseMainRef(aux),
        embUseMain: isUseMainRef(embedding),
        maxTurns: chat.maxTurns,
        credentialBuckets: Object.keys(credentials),
      });
      message.success('配置已保存');
    } catch (err) {
      logger.error('保存失败', (err as Error).message);
      message.error(`保存失败：${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const mainResult = mainProviderSchema.safeParse(main);
    if (!mainResult.success) {
      message.error(mainResult.error.errors[0]?.message ?? '主 Provider 配置校验失败');
      return;
    }
    const auxResult = llmProviderOrRefSchema.safeParse(aux);
    if (!auxResult.success) {
      message.error(auxResult.error.errors[0]?.message ?? '辅助 Provider 配置校验失败');
      return;
    }
    const embResult = embeddingProviderOrRefSchema.safeParse(embedding);
    if (!embResult.success) {
      message.error(embResult.error.errors[0]?.message ?? 'Embedding Provider 配置校验失败');
      return;
    }
    const chatResult = chatSettingsSchema.safeParse(chat);
    if (!chatResult.success) {
      message.error(chatResult.error.errors[0]?.message ?? '对话设置校验失败');
      return;
    }
    const memResult = memorySettingsSchema.safeParse(memorySettings);
    if (!memResult.success) {
      message.error(memResult.error.errors[0]?.message ?? '记忆设置校验失败');
      return;
    }

    // 软校验：主 Provider 无 embedding 能力 + embedding useMain=true → Modal 二次确认
    const mainEntry = PROVIDER_REGISTRY[main.kind];
    if (mainEntry && mainEntry.embedding === null && isUseMainRef(embedding)) {
      const confirmed = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: '⚠️ 向量召回可能不可用',
          content: (
            <div>
              <p>
                当前主 Provider 为 <strong>{mainEntry.displayName}</strong>
                ，其未提供 embedding 服务，而 Embedding Provider 选择了
                <strong>「复用主 Provider」</strong>。保存后记忆召回可能不工作（自动降级到关键词召回）。
              </p>
              <p>建议切换到 Qwen text-embedding-v3 作为向量模型。</p>
            </div>
          ),
          okText: '改成推荐配置',
          cancelText: '继续保存',
          onOk: () => {
            setEmbedding({
              kind: 'qwen-embedding',
              baseURL: DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK.baseURL,
              model: 'text-embedding-v3',
              dimension: 1024,
              apiKey: '',
            });
            message.info('已切换到 Qwen text-embedding-v3，请在 Memory Tab 填入 API Key 后重新保存');
            resolve(false);
          },
          onCancel: () => resolve(true),
        });
      });
      if (!confirmed) return;
    }

    await persistAll();
  };

  const handleReset = () => {
    setMain(DEFAULT_MAIN_PROVIDER_CONFIG);
    setAux(DEFAULT_AUX_PROVIDER_CONFIG);
    setEmbedding(DEFAULT_EMBEDDING_PROVIDER_CONFIG);
    setChat(DEFAULT_CHAT_SETTINGS);
    setMemorySettings(DEFAULT_MEMORY_SETTINGS);
    setCredentials(DEFAULT_PROVIDER_CREDENTIALS);
    message.info('已重置为默认值（未保存）');
  };

  /**
   * 写回凭证桶：给定 kind 更新其 apiKey/baseURL
   * - apiKey 空串也要写（用户可能显式清空）
   * - baseURL 若等于 registry 默认值则不入桶（避免无意义数据）
   */
  const updateCredential = (
    kind: ProviderKind,
    patch: Partial<{ apiKey: string; baseURL: string }>,
  ) => {
    setCredentials((prev) => {
      const prevSlot = prev[kind] ?? { apiKey: '' };
      const nextApiKey = patch.apiKey !== undefined ? patch.apiKey : prevSlot.apiKey;
      const defaultBase = PROVIDER_REGISTRY[kind]?.defaultConfig.baseURL;
      const incomingBase = patch.baseURL !== undefined ? patch.baseURL : prevSlot.baseURL;
      const nextSlot = {
        apiKey: nextApiKey,
        ...(incomingBase && incomingBase !== defaultBase ? { baseURL: incomingBase } : {}),
      };
      return { ...prev, [kind]: nextSlot };
    });
  };

  /**
   * 主 Provider 修改的包装：
   * - kind 切换 → 从桶读出新 kind 的凭证回填（保留 model/enableThinking 取决于调用方，
   *   这里不做额外处理；BasicTab 的 handleKindChange 已经选好了默认 model）
   * - apiKey/baseURL 修改 → 同步写回桶
   */
  const handleMainChange = (next: LLMProviderConfig) => {
    const prev = main;
    if (next.kind !== prev.kind) {
      // kind 切换：把新 kind 的桶内凭证带出覆盖
      const defaultBase = PROVIDER_REGISTRY[next.kind]?.defaultConfig.baseURL ?? next.baseURL;
      const resolved = resolveCredentialFor(credentials, next.kind, {
        apiKey: '', // 没有桶记录时 apiKey 留空，提醒用户填
        baseURL: next.baseURL || defaultBase,
      });
      setMain({ ...next, apiKey: resolved.apiKey, baseURL: resolved.baseURL });
      return;
    }
    // 非 kind 切换：常规更新 + 同步桶
    setMain(next);
    const patch: Partial<{ apiKey: string; baseURL: string }> = {};
    if (next.apiKey !== prev.apiKey) patch.apiKey = next.apiKey;
    if (next.baseURL !== prev.baseURL) patch.baseURL = next.baseURL;
    if (patch.apiKey !== undefined || patch.baseURL !== undefined) {
      updateCredential(next.kind, patch);
    }
  };

  /** 辅助 Provider 同理 */
  const handleAuxChange = (next: ProviderConfigOrRef<LLMProviderConfig>) => {
    const prev = aux;
    // useMain 切换或保持 useMain：不涉及凭证桶更新
    if (isUseMainRef(next)) {
      setAux(next);
      return;
    }
    // 关掉 useMain 或修改字段
    const nextCfg = next as LLMProviderConfig;
    if (isUseMainRef(prev)) {
      // 从 useMain 切到自定义：带出桶里该 kind 的凭证
      const resolved = resolveCredentialFor(credentials, nextCfg.kind, {
        apiKey: nextCfg.apiKey,
        baseURL: nextCfg.baseURL,
      });
      setAux({ ...nextCfg, apiKey: resolved.apiKey, baseURL: resolved.baseURL });
      return;
    }
    const prevCfg = prev as LLMProviderConfig;
    if (nextCfg.kind !== prevCfg.kind) {
      // kind 切换：从桶带出
      const resolved = resolveCredentialFor(credentials, nextCfg.kind, {
        apiKey: '',
        baseURL: nextCfg.baseURL,
      });
      setAux({ ...nextCfg, apiKey: resolved.apiKey, baseURL: resolved.baseURL });
      return;
    }
    // 常规更新 + 同步桶
    setAux(next);
    const patch: Partial<{ apiKey: string; baseURL: string }> = {};
    if (nextCfg.apiKey !== prevCfg.apiKey) patch.apiKey = nextCfg.apiKey;
    if (nextCfg.baseURL !== prevCfg.baseURL) patch.baseURL = nextCfg.baseURL;
    if (patch.apiKey !== undefined || patch.baseURL !== undefined) {
      updateCredential(nextCfg.kind, patch);
    }
  };

  /**
   * Embedding Provider 的 apiKey 与 LLM 共享同一 Provider 桶
   * 目前 embedding kind 固定为 'qwen-embedding'，对应 Provider kind 为 'qwen'
   */
  const handleEmbeddingChange = (next: ProviderConfigOrRef<EmbeddingProviderConfig>) => {
    const prev = embedding;
    if (isUseMainRef(next)) {
      setEmbedding(next);
      return;
    }
    const nextCfg = next as EmbeddingProviderConfig;
    if (isUseMainRef(prev)) {
      // 从 useMain 切到自定义：embedding 共享 qwen 桶
      const resolved = resolveCredentialFor(credentials, 'qwen', {
        apiKey: nextCfg.apiKey,
        baseURL: nextCfg.baseURL,
      });
      setEmbedding({ ...nextCfg, apiKey: resolved.apiKey, baseURL: resolved.baseURL });
      return;
    }
    const prevCfg = prev as EmbeddingProviderConfig;
    setEmbedding(next);
    const patch: Partial<{ apiKey: string; baseURL: string }> = {};
    if (nextCfg.apiKey !== prevCfg.apiKey) patch.apiKey = nextCfg.apiKey;
    if (nextCfg.baseURL !== prevCfg.baseURL) patch.baseURL = nextCfg.baseURL;
    if (patch.apiKey !== undefined || patch.baseURL !== undefined) {
      updateCredential('qwen', patch);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#8c8c8c' }}>正在加载配置…</div>
    );
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 24px 96px' }}>
      {modalContextHolder}
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Doc Assistant · 配置
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        所有配置仅保存在本地浏览器（chrome.storage.local），不会上传任何服务器。
      </Typography.Paragraph>

      <Tabs
        defaultActiveKey="basic"
        items={[
          {
            key: 'basic',
            label: '基础',
            children: (
              <BasicTab main={main} onMainChange={handleMainChange} chat={chat} onChatChange={setChat} />
            ),
          },
          {
            key: 'memory',
            label: '记忆',
            children: (
              <MemoryTab
                main={main}
                aux={aux}
                onAuxChange={handleAuxChange}
                embedding={embedding}
                onEmbeddingChange={handleEmbeddingChange}
                settings={memorySettings}
                onSettingsChange={setMemorySettings}
              />
            ),
          },
          {
            key: 'memory-browser',
            label: '记忆浏览器',
            children: <MemoryBrowserTab memory={memory} />,
          },
          {
            key: 'advanced',
            label: '高级',
            children: <AdvancedTab chat={chat} onChatChange={setChat} />,
          },
          {
            key: 'debug',
            label: '调试',
            children: <DebugTab memory={memory} storage={storage} />,
          },
        ]}
      />

      {/* 底部保存栏 */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid #e8e8e8',
          padding: '12px 24px',
          display: 'flex',
          justifyContent: 'center',
          zIndex: 10,
        }}
      >
        <Space>
          <Button onClick={handleReset}>重置为默认</Button>
          <Button type="primary" onClick={handleSave} loading={saving}>
            保存
          </Button>
        </Space>
      </div>
    </div>
  );
}
