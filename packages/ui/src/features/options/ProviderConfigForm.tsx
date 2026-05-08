/**
 * ProviderConfigForm · 可复用的 Provider 配置表单
 * ---------------------------------------------
 * 用于"辅助 Provider"与"Embedding Provider"的配置（两者都支持"复用主 Provider"开关）。
 *
 * v0.6.0-beta.2 · Breaking：apiKey/baseURL 不再在 `LLMProviderConfig` 内，
 * 由父组件传入 `credential` 与 `onCredentialChange`，本组件只负责 UI 层的输入/显示。
 *
 * 支持两种 mode：
 * - 'llm'：kind 下拉 + baseURL + model + apiKey [+ 可选 enableThinking]
 * - 'embedding'：baseURL + model + apiKey + dimension（kind 固定为 'qwen-embedding'）
 */
import {
  Alert,
  AutoComplete,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { useMemo, useState, type ReactNode } from 'react';
import {
  createLogger,
  maskSecret,
  type EmbeddingProviderConfig,
  type LLMProviderConfig,
  type ProviderConfigOrRef,
  type ProviderKind,
} from '@doc-assistant/shared';
import {
  PROVIDER_REGISTRY,
  listProviderEntries,
  type GenericModelListItem,
} from '@doc-assistant/provider';
import { splitSnapshots } from './model-list-helpers';

const logger = createLogger('ui:options:provider-config');

export interface ProviderCredentialView {
  apiKey: string;
  baseURL: string;
}

export interface ProviderConfigFormProps<T extends LLMProviderConfig | EmbeddingProviderConfig> {
  mode: T extends LLMProviderConfig ? 'llm' : 'embedding';
  value: ProviderConfigOrRef<T>;
  onChange: (next: ProviderConfigOrRef<T>) => void;
  /** 当取消"复用主 Provider"时用到的 fallback 值（不含 apiKey/baseURL） */
  fallback: T;
  /** 当前 value 对应的凭证（来自桶）；useMain=true 时不展示 */
  credential: ProviderCredentialView;
  /** 凭证输入变更回调；写回凭证桶 */
  onCredentialChange: (patch: Partial<{ apiKey: string; baseURL: string }>) => void;
  /** 是否允许"复用主 Provider"开关（默认 true） */
  useMainAllowed?: boolean;
  /** 额外顶部提示 */
  hint?: ReactNode;
}

function isUseMainRef(v: unknown): v is { useMain: true } {
  return !!v && typeof v === 'object' && (v as { useMain?: boolean }).useMain === true;
}

export function ProviderConfigForm<T extends LLMProviderConfig | EmbeddingProviderConfig>(
  props: ProviderConfigFormProps<T>,
) {
  const {
    mode,
    value,
    onChange,
    fallback,
    credential,
    onCredentialChange,
    useMainAllowed = true,
    hint,
  } = props;
  const useMain = isUseMainRef(value);

  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<GenericModelListItem[] | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [searchText, setSearchText] = useState('');

  const toggleUseMain = (checked: boolean) => {
    if (checked) {
      onChange({ useMain: true });
    } else {
      onChange(fallback);
      // 切换回自定义模式时重置拉取缓存
      setFetchedModels(null);
    }
  };

  const concrete = useMain ? fallback : (value as T);
  const keyMask = maskSecret(credential.apiKey);

  const update = (patch: Partial<T>) => {
    if (useMain) return;
    onChange({ ...(concrete as T), ...patch } as ProviderConfigOrRef<T>);
  };

  /** llm mode 的 kind 切换 */
  const handleKindChange = (nextKind: ProviderKind) => {
    if (mode !== 'llm' || useMain) return;
    const current = concrete as LLMProviderConfig;
    const nextEntry = PROVIDER_REGISTRY[nextKind];
    if (!nextEntry) return;
    // 两家思考开关形态不同，按 kind 分路拼装：
    //  - qwen     → `enableThinking: boolean`
    //  - deepseek → `thinking: 'enabled' | 'disabled'`
    const nextDefault = nextEntry.defaultConfig;
    if (nextKind === 'qwen') {
      update({
        kind: 'qwen',
        model: nextDefault.model,
        enableThinking: nextDefault.enableThinking ?? current.enableThinking ?? false,
      } as unknown as Partial<T>);
    } else {
      update({
        kind: 'deepseek',
        model: nextDefault.model,
        thinking: nextDefault.thinking ?? current.thinking ?? 'enabled',
      } as unknown as Partial<T>);
    }
    setFetchedModels(null);
    setSearchText('');
  };

  const handleFetchModels = async () => {
    if (!credential.apiKey || !credential.baseURL) {
      message.error('请先填写 API Key 与 Base URL');
      return;
    }
    setFetchingModels(true);
    try {
      let all: GenericModelListItem[];
      if (mode === 'llm') {
        const kind = (concrete as LLMProviderConfig).kind;
        const entry = PROVIDER_REGISTRY[kind];
        if (!entry) {
          message.error(`未知的 Provider kind: ${kind}`);
          return;
        }
        all = await entry.listModels({
          apiKey: credential.apiKey,
          baseURL: credential.baseURL,
        });
      } else {
        // embedding mode：目前只支持 qwen-embedding，走 Qwen registry 拉列表
        all = await PROVIDER_REGISTRY.qwen.listModels({
          apiKey: credential.apiKey,
          baseURL: credential.baseURL,
        });
      }
      const wantedKind: 'chat' | 'embedding' = mode === 'llm' ? 'chat' : 'embedding';
      const filtered = all.filter((m) => m.kind === wantedKind);
      setFetchedModels(filtered);
      logger.info('拉取模型列表成功', {
        mode,
        total: all.length,
        matched: filtered.length,
        apiKey: maskSecret(credential.apiKey),
      });
      message.success(
        `已拉取 ${filtered.length} 个${wantedKind === 'chat' ? '对话' : '嵌入'}模型（总 ${all.length} 个）`,
      );
    } catch (err) {
      logger.error('拉取模型列表失败', (err as Error).message);
      message.error(`拉取失败：${(err as Error).message}`);
    } finally {
      setFetchingModels(false);
    }
  };

  const providerEntry = useMemo(() => {
    if (mode === 'llm' && !useMain) {
      return PROVIDER_REGISTRY[(concrete as LLMProviderConfig).kind];
    }
    return undefined;
  }, [mode, useMain, concrete]);

  const providerOptions = useMemo(
    () =>
      listProviderEntries().map((e) => ({
        label: e.displayName,
        value: e.kind,
      })),
    [],
  );

  const { options: modelOptions, stats } = useMemo<{
    options: Array<{ value: string; label: ReactNode }>;
    stats: { total: number; snapshotHidden: number };
  }>(() => {
    if (!fetchedModels || fetchedModels.length === 0) {
      const fallbackList: readonly string[] =
        mode === 'llm' && providerEntry
          ? providerEntry.suggestedModels
          : mode === 'embedding'
            ? ['text-embedding-v3', 'text-embedding-v2']
            : [];
      return {
        options: fallbackList.map((m) => ({ value: m, label: m })),
        stats: { total: 0, snapshotHidden: 0 },
      };
    }

    const { primary, snapshotCount } = splitSnapshots(fetchedModels);
    const base = showSnapshots ? fetchedModels : primary;

    const needle = searchText.trim().toLowerCase();
    const filtered = needle ? base.filter((m) => m.id.toLowerCase().includes(needle)) : base;

    return {
      options: filtered.map((m) => ({
        value: m.id,
        label:
          mode === 'llm' && m.capability ? (
            <Space size={6}>
              <span>{m.id}</span>
              <Tooltip
                title={`context ≈ ${m.capability.contextWindow} tokens${typeof m.capability.maxOutputTokens === 'number' ? ` · max_out ≈ ${m.capability.maxOutputTokens} tokens` : ''}${m.capability.supportsReasoning ? ' · 支持思考' : ''}${m.capability.supportsTools ? ' · 支持工具' : ''}`}
              >
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                  已知能力
                </Tag>
              </Tooltip>
            </Space>
          ) : (
            m.id
          ),
      })),
      stats: {
        total: fetchedModels.length,
        snapshotHidden: snapshotCount,
      },
    };
  }, [fetchedModels, mode, providerEntry, showSnapshots, searchText]);

  const currentKind = mode === 'llm' ? (concrete as LLMProviderConfig).kind : undefined;

  return (
    <>
      {hint ? <Alert type="info" showIcon message={hint} style={{ marginBottom: 12 }} /> : null}

      {useMainAllowed ? (
        <Form.Item
          label="复用主 Provider 配置"
          extra={
            useMain
              ? '当前使用主 Provider 的 baseURL / model / apiKey；关闭以单独配置。'
              : '已自定义，下方字段独立保存。'
          }
        >
          <Switch checked={useMain} onChange={toggleUseMain} />
        </Form.Item>
      ) : null}

      {mode === 'llm' && !useMain && currentKind ? (
        <Form.Item label="Provider">
          <Select
            value={currentKind}
            onChange={(v: ProviderKind) => handleKindChange(v)}
            options={providerOptions}
          />
          {providerEntry?.description ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {providerEntry.description}
            </Typography.Text>
          ) : null}
        </Form.Item>
      ) : null}

      <Form.Item
        label="API Key"
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            日志中将脱敏显示为
            <code style={{ marginLeft: 4 }}>{keyMask || '****'}</code>。
          </Typography.Text>
        }
      >
        <Input.Password
          value={credential.apiKey}
          onChange={(e) => onCredentialChange({ apiKey: e.target.value })}
          placeholder="sk-..."
          autoComplete="off"
          disabled={useMain}
        />
      </Form.Item>

      <Form.Item label="Base URL">
        <Input
          value={credential.baseURL}
          onChange={(e) => onCredentialChange({ baseURL: e.target.value })}
          disabled={useMain}
        />
      </Form.Item>

      <Form.Item
        label="模型"
        extra={
          useMain
            ? '复用主 Provider 时此字段禁用；去基础页拉取主 Provider 的模型列表。'
            : fetchedModels
              ? `列表来自账号 /models 接口（${stats.total} 个${mode === 'llm' ? '对话' : '嵌入'}模型${stats.snapshotHidden && !showSnapshots ? `；隐藏 ${stats.snapshotHidden} 个历史快照` : ''}）。支持手动输入自定义模型名。`
              : '默认显示常用建议值；点击右侧「拉取可用模型」可获取账号下实际可用的完整列表。'
        }
      >
        <Space.Compact style={{ width: '100%' }}>
          <AutoComplete
            value={concrete.model}
            onChange={(v) => update({ model: v } as Partial<T>)}
            onSearch={setSearchText}
            options={modelOptions}
            placeholder="选择或输入模型名"
            style={{ flex: 1 }}
            filterOption={false}
            allowClear
            disabled={useMain}
          />
          <Button
            onClick={handleFetchModels}
            loading={fetchingModels}
            disabled={useMain}
          >
            拉取可用模型
          </Button>
        </Space.Compact>
        {fetchedModels && !useMain ? (
          <div style={{ marginTop: 6 }}>
            <Space size={6}>
              <Switch
                size="small"
                checked={showSnapshots}
                onChange={setShowSnapshots}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                显示历史快照版本（YYYY-MM-DD / latest）
              </Typography.Text>
            </Space>
          </div>
        ) : null}
      </Form.Item>

      {mode === 'llm' && (() => {
        const llm = concrete as LLMProviderConfig;
        if (llm.kind === 'qwen') {
          return (
            <Form.Item
              label="启用思考模式（reasoning_content）"
              extra="仅部分模型支持（如 qwen3 系列）。开启后会流式展示模型自发返回的思考过程折叠块。"
            >
              <Switch
                checked={!!llm.enableThinking}
                onChange={(v) =>
                  update({ enableThinking: v } as unknown as Partial<T>)
                }
                disabled={useMain}
              />
            </Form.Item>
          );
        }
        // deepseek
        return (
          <Form.Item
            label="思考模式"
            extra="DeepSeek 官方 API 原生参数 `thinking`，控制是否启用思考模式；透传为请求体顶层 `thinking: { type }`，默认启用。"
          >
            <Select
              value={llm.thinking ?? 'enabled'}
              onChange={(v: 'enabled' | 'disabled') =>
                update({ thinking: v } as unknown as Partial<T>)
              }
              options={[
                { label: '启用思考（enabled）', value: 'enabled' },
                { label: '关闭思考（disabled）', value: 'disabled' },
              ]}
              disabled={useMain}
              style={{ width: 240 }}
            />
          </Form.Item>
        );
      })()}

      {mode === 'embedding' && (
        <Form.Item
          label="维度"
          extra="v2=1536，v3=1024；更换模型必须重建向量索引。"
        >
          <InputNumber
            value={(concrete as EmbeddingProviderConfig).dimension}
            onChange={(v) => update({ dimension: Number(v) || 0 } as unknown as Partial<T>)}
            min={1}
            max={8192}
            disabled={useMain}
            style={{ width: 120 }}
          />
        </Form.Item>
      )}
    </>
  );
}
