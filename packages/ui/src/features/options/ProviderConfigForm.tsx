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
 */
import { Alert, Form, Input, InputNumber, Select, Switch, Typography } from 'antd';
import type { ReactNode } from 'react';
import {
  QWEN_EMBEDDING_MODELS,
  QWEN_MODELS,
  maskSecret,
  type EmbeddingProviderConfig,
  type LLMProviderConfig,
  type ProviderConfigOrRef,
} from '@doc-assistant/shared';

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

  const modelOptions: Array<{ label: string; value: string }> =
    mode === 'llm'
      ? QWEN_MODELS.map((m) => ({ label: m, value: m }))
      : QWEN_EMBEDDING_MODELS.map((m) => ({ label: m, value: m }));

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

      <Form.Item label="模型">
        <Select
          value={concrete.model}
          onChange={(v) => update({ model: v } as Partial<T>)}
          showSearch
          options={modelOptions}
          disabled={useMain}
        />
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
