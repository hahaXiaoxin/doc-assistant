/**
 * ProviderConfigForm · 可复用的 Provider 配置表单
 * ---------------------------------------------
 * v0.2 · 用于"辅助 Provider"与"Embedding Provider"的配置（两者都支持"复用主 Provider"开关）
 *
 * 主 Provider 的表单字段有专属的 Options 约束（model 下拉 / enableThinking 等），
 * 所以主 Provider 不走这个组件，由 BasicTab 单独维护。
 *
 * 这里支持两种 mode：
 * - 'llm'：baseURL + model + apiKey [+ 可选 enableThinking]
 * - 'embedding'：baseURL + model + apiKey + dimension
 *
 * 值结构：ProviderConfigOrRef<T>
 *   - { useMain: true } → 禁用字段，仅显示"复用主 Provider"勾选
 *   - 完整对象     → 展开字段
 *
 * v0.2.1 新增：拉取可用模型
 * - 调用 listQwenModels 拉完整列表，按 mode 过滤 kind（llm→chat / embedding→embedding）
 * - 失败不阻塞；结果仅本次会话有效，不持久化
 * - useMain=true 时按钮禁用（应去 BasicTab 主 Provider 里拉）
 */
import {
  Alert,
  AutoComplete,
  Button,
  Form,
  Input,
  InputNumber,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { useMemo, useState, type ReactNode } from 'react';
import {
  QWEN_EMBEDDING_MODELS,
  QWEN_MODELS,
  createLogger,
  maskSecret,
  type EmbeddingProviderConfig,
  type LLMProviderConfig,
  type ProviderConfigOrRef,
} from '@doc-assistant/shared';
import { listQwenModels, type QwenModelListItem } from '@doc-assistant/provider';
import { splitSnapshots } from './model-list-helpers';

const logger = createLogger('ui:options:provider-config');

export interface ProviderConfigFormProps<T extends LLMProviderConfig | EmbeddingProviderConfig> {
  mode: T extends LLMProviderConfig ? 'llm' : 'embedding';
  value: ProviderConfigOrRef<T>;
  onChange: (next: ProviderConfigOrRef<T>) => void;
  /** 当取消"复用主 Provider"时用到的 fallback 值 */
  fallback: T;
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
  const { mode, value, onChange, fallback, useMainAllowed = true, hint } = props;
  const useMain = isUseMainRef(value);

  const [fetchingModels, setFetchingModels] = useState(false);
  /** 拉取到的模型（已按 mode 过滤）。null = 尚未拉过，走固定建议值 */
  const [fetchedModels, setFetchedModels] = useState<QwenModelListItem[] | null>(null);
  /** 是否显示历史快照版本（-YYYY-MM-DD / -latest） */
  const [showSnapshots, setShowSnapshots] = useState(false);
  /** AutoComplete 搜索词（受控；避免 value 被当搜索词） */
  const [searchText, setSearchText] = useState('');

  const toggleUseMain = (checked: boolean) => {
    if (checked) {
      onChange({ useMain: true });
    } else {
      onChange(fallback);
    }
  };

  const concrete = useMain ? fallback : (value as T);
  const keyMask = maskSecret(concrete.apiKey);

  const update = (patch: Partial<T>) => {
    if (useMain) return; // useMain 时字段禁用
    onChange({ ...(concrete as T), ...patch } as ProviderConfigOrRef<T>);
  };

  const handleFetchModels = async () => {
    if (!concrete.apiKey || !concrete.baseURL) {
      message.error('请先填写 API Key 与 Base URL');
      return;
    }
    setFetchingModels(true);
    try {
      const all = await listQwenModels({
        apiKey: concrete.apiKey,
        baseURL: concrete.baseURL,
      });
      const wantedKind: 'chat' | 'embedding' = mode === 'llm' ? 'chat' : 'embedding';
      const filtered = all.filter((m) => m.kind === wantedKind);
      setFetchedModels(filtered);
      logger.info('拉取模型列表成功', {
        mode,
        total: all.length,
        matched: filtered.length,
        apiKey: maskSecret(concrete.apiKey),
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

  const { options: modelOptions, stats } = useMemo<{
    options: Array<{ value: string; label: ReactNode }>;
    stats: { total: number; snapshotHidden: number };
  }>(() => {
    if (!fetchedModels || fetchedModels.length === 0) {
      const fallbackList = mode === 'llm' ? QWEN_MODELS : QWEN_EMBEDDING_MODELS;
      return {
        options: fallbackList.map((m) => ({ value: m, label: m })),
        stats: { total: 0, snapshotHidden: 0 },
      };
    }

    // 快照折叠 + 搜索过滤
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
                title={`context ≈ ${m.capability.contextWindow} tokens${m.capability.supportsReasoning ? ' · 支持思考' : ''}${m.capability.supportsTools ? ' · 支持工具' : ''}`}
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
  }, [fetchedModels, mode, showSnapshots, searchText]);

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
          value={concrete.apiKey}
          onChange={(e) => update({ apiKey: e.target.value } as Partial<T>)}
          placeholder="sk-..."
          autoComplete="off"
          disabled={useMain}
        />
      </Form.Item>

      <Form.Item label="Base URL">
        <Input
          value={concrete.baseURL}
          onChange={(e) => update({ baseURL: e.target.value } as Partial<T>)}
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
            // 过滤完全交给 useMemo 里的 searchText，关掉 AutoComplete 内置 filterOption
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

      {mode === 'llm' && (
        <Form.Item
          label="启用思考模式（reasoning_content）"
          extra="仅 qwen3 系列等支持思考的模型有效。"
        >
          <Switch
            checked={!!(concrete as LLMProviderConfig).enableThinking}
            onChange={(v) => update({ enableThinking: v } as unknown as Partial<T>)}
            disabled={useMain}
          />
        </Form.Item>
      )}

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

