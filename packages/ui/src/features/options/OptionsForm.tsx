/**
 * OptionsForm · Tabs 容器
 * ---------------------------------------------
 * 职责：
 * - 加载 STORAGE_KEYS
 * - 将各段配置（main / aux / embedding / chat / memorySettings）分发给对应 Tab
 * - 统一的 Save / Reset 底部吸附栏
 *
 * v0.6.0-beta.2 · Breaking：
 * - zod schema 改为 `z.discriminatedUnion('kind', [...])`，每个 registry kind 一个子 schema
 * - `LLMProviderConfig` / `EmbeddingProviderConfig` 里不再含 apiKey/baseURL
 *   — 凭证统一走 `providerCredentials` 桶（唯一真源），不再提供迁移
 * - 保存前软校验：main=DeepSeek + embedding useMain=true 时弹 Modal.confirm
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Space, Tabs, Typography, message } from 'antd';
import {
  DEFAULT_AUX_PROVIDER_CONFIG,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_EMBEDDING_PROVIDER_CONFIG,
  DEFAULT_MAIN_PROVIDER_CONFIG,
  DEFAULT_MEMORY_SETTINGS,
  DEFAULT_PROVIDER_CREDENTIALS,
  STORAGE_KEYS,
  clampMaxTurns,
  createLogger,
  maskSecret,
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

/* ------------------------------------------------------------------ */
/* zod schemas                                                         */
/* ------------------------------------------------------------------ */

/**
 * 主 Provider schema：思考模式对外统一为 `thinking: boolean`（各 Provider 内部翻译）。
 * 通过 `z.discriminatedUnion('kind', ...)` 仍保留 kind 的类型安全，但两家的 schema
 * 形状完全一致。
 */
const qwenMainSchema = z.object({
  kind: z.literal('qwen'),
  model: z.string().trim().min(1, '请选择主 Provider 模型'),
  thinking: z.boolean().optional(),
});

const deepseekMainSchema = z.object({
  kind: z.literal('deepseek'),
  model: z.string().trim().min(1, '请选择主 Provider 模型'),
  thinking: z.boolean().optional(),
});

const mainProviderSchema = z.discriminatedUnion('kind', [qwenMainSchema, deepseekMainSchema]);

const llmProviderOrRefSchema = z.union([
  z.object({ useMain: z.literal(true) }),
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('qwen'),
      model: z.string().trim().min(1),
      thinking: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal('deepseek'),
      model: z.string().trim().min(1),
      thinking: z.boolean().optional(),
    }),
  ]),
]);

const embeddingProviderOrRefSchema = z.union([
  z.object({ useMain: z.literal(true) }),
  z.object({
    kind: z.literal('qwen-embedding'),
    model: z.string().trim().min(1),
    dimension: z.number().int().positive(),
  }),
]);

/** 凭证桶 schema（仅校验形状，不校验 apiKey/baseURL 的填值——那由主 Provider 的 missingConfig 覆盖） */
const providerCredentialsSchema = z.record(
  z.object({
    apiKey: z.string(),
    baseURL: z.string().optional(),
  }),
);

/**
 * 主 Provider 的凭证必须填 apiKey。这是 UI 层面的"最低门槛"校验，
 * 让用户无法保存一个显然不能用的主 Provider。
 */
function validateMainCredential(
  credentials: ProviderCredentialsMap,
  kind: ProviderKind,
): string | null {
  const slot = credentials[kind];
  if (!slot || !slot.apiKey.trim()) {
    return `请填写主 Provider (${PROVIDER_REGISTRY[kind]?.displayName ?? kind}) 的 API Key`;
  }
  return null;
}

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

/** 从桶取某 kind 的凭证视图（baseURL 回落到 registry 默认） */
function viewCredential(
  credentials: ProviderCredentialsMap,
  kind: ProviderKind,
): { apiKey: string; baseURL: string } {
  const slot = credentials[kind];
  const defaultBase = PROVIDER_REGISTRY[kind]?.defaultBaseURL ?? '';
  return {
    apiKey: slot?.apiKey ?? '',
    baseURL: slot?.baseURL ?? defaultBase,
  };
}

export function OptionsForm({ storage, memory = null }: OptionsFormProps) {
  const [main, setMain] = useState<LLMProviderConfig>(DEFAULT_MAIN_PROVIDER_CONFIG);
  const [aux, setAux] =
    useState<ProviderConfigOrRef<LLMProviderConfig>>(DEFAULT_AUX_PROVIDER_CONFIG);
  const [embedding, setEmbedding] =
    useState<ProviderConfigOrRef<EmbeddingProviderConfig>>(DEFAULT_EMBEDDING_PROVIDER_CONFIG);
  const [chat, setChat] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [memorySettings, setMemorySettings] = useState<MemorySettings>(DEFAULT_MEMORY_SETTINGS);
  const [credentials, setCredentials] = useState<ProviderCredentialsMap>(
    DEFAULT_PROVIDER_CREDENTIALS,
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, modalContextHolder] = Modal.useModal();

  const mainCredential = viewCredential(credentials, main.kind);
  const keyMask = useMemo(() => maskSecret(mainCredential.apiKey), [mainCredential.apiKey]);

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

      setCredentials(credsStored ?? DEFAULT_PROVIDER_CREDENTIALS);

      if (mainStored) {
        // 兜底：脏数据中 kind 缺失时落回 qwen
        const kind = mainStored.kind ?? DEFAULT_MAIN_PROVIDER_CONFIG.kind;
        setMain({
          ...DEFAULT_MAIN_PROVIDER_CONFIG,
          ...mainStored,
          kind,
        });
      }

      if (auxStored) setAux(auxStored);
      if (embStored) setEmbedding(embStored);

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
    const mainCredErr = validateMainCredential(credentials, main.kind);
    if (mainCredErr) {
      message.error(mainCredErr);
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
    const credsResult = providerCredentialsSchema.safeParse(credentials);
    if (!credsResult.success) {
      message.error(credsResult.error.errors[0]?.message ?? 'Provider 凭证校验失败');
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
              model: 'text-embedding-v3',
              dimension: 1024,
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
   * 写回凭证桶：给定 kind 更新其 apiKey/baseURL。
   * - apiKey 空串也写入（用户可能显式清空）
   * - baseURL 若等于 registry 默认值则不入桶（避免无意义数据膨胀）
   */
  const updateCredential = (
    kind: ProviderKind,
    patch: Partial<{ apiKey: string; baseURL: string }>,
  ) => {
    setCredentials((prev) => {
      const prevSlot = prev[kind] ?? { apiKey: '' };
      const nextApiKey = patch.apiKey !== undefined ? patch.apiKey : prevSlot.apiKey;
      const defaultBase = PROVIDER_REGISTRY[kind]?.defaultBaseURL;
      const incomingBase = patch.baseURL !== undefined ? patch.baseURL : prevSlot.baseURL;
      const nextSlot: { apiKey: string; baseURL?: string } = {
        apiKey: nextApiKey,
        ...(incomingBase && incomingBase !== defaultBase ? { baseURL: incomingBase } : {}), // 保留:多条件复合(非空且不等于默认值)
      };
      return { ...prev, [kind]: nextSlot };
    });
  };

  // aux Kind 对应的凭证（非 useMain 时展示）
  const auxCredential = isUseMainRef(aux)
    ? mainCredential
    : viewCredential(credentials, (aux as LLMProviderConfig).kind);

  // embedding 共享 qwen 桶（kind 永远是 qwen-embedding）
  const embeddingCredential = isUseMainRef(embedding)
    ? mainCredential
    : viewCredential(credentials, 'qwen');

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
              <BasicTab
                main={main}
                onMainChange={setMain}
                credential={mainCredential}
                onCredentialChange={(patch) => updateCredential(main.kind, patch)}
                chat={chat}
                onChatChange={setChat}
              />
            ),
          },
          {
            key: 'memory',
            label: '记忆',
            children: (
              <MemoryTab
                main={main}
                mainCredential={mainCredential}
                aux={aux}
                onAuxChange={setAux}
                auxCredential={auxCredential}
                onAuxCredentialChange={(kind, patch) => updateCredential(kind, patch)}
                embedding={embedding}
                onEmbeddingChange={setEmbedding}
                embeddingCredential={embeddingCredential}
                onEmbeddingCredentialChange={(patch) => updateCredential('qwen', patch)}
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
