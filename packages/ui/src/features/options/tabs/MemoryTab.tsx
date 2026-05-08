/**
 * MemoryTab · 记忆层配置
 * ---------------------------------------------
 * 职责：
 * - 辅助 Provider 配置（默认复用主 Provider；可单独配置）
 * - Embedding Provider 配置（同上）
 * - 敏感信息过滤开关
 * - 反思 Job 开关
 * - WorkingMemory TTL 天数
 *
 * v0.4.0：原"长期指令审核"占位 Card 已删除——审核入口统一走 sidebar 的
 * PersonaReviewBanner；浏览/编辑/清理入口走新的"记忆浏览器" Tab。
 *
 * v0.6.0-beta.2：
 * - 当主 Provider 为 DeepSeek 且 embedding 仍 useMain=true 时，顶部警告 +
 *   "一键使用推荐配置（Qwen text-embedding-v3）"按钮
 * - apiKey / baseURL 凭证改由父组件按 kind 从桶读写，本组件只转发
 */
import { Alert, Button, Card, Form, InputNumber, Switch } from 'antd';
import {
  DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK,
  type EmbeddingProviderConfig,
  type LLMProviderConfig,
  type MemorySettings,
  type ProviderConfigOrRef,
  type ProviderKind,
} from '@doc-assistant/shared';
import { PROVIDER_REGISTRY } from '@doc-assistant/provider';
import { ProviderConfigForm, type ProviderCredentialView } from '../ProviderConfigForm';

export interface MemoryTabProps {
  main: LLMProviderConfig;
  /** 主 Provider 的凭证（useMain=true 时辅助/embedding 显示这个） */
  mainCredential: ProviderCredentialView;
  aux: ProviderConfigOrRef<LLMProviderConfig>;
  onAuxChange: (next: ProviderConfigOrRef<LLMProviderConfig>) => void;
  /** aux 当前展开（非 useMain）时对应 kind 的凭证 */
  auxCredential: ProviderCredentialView;
  onAuxCredentialChange: (kind: ProviderKind, patch: Partial<{ apiKey: string; baseURL: string }>) => void;
  embedding: ProviderConfigOrRef<EmbeddingProviderConfig>;
  onEmbeddingChange: (next: ProviderConfigOrRef<EmbeddingProviderConfig>) => void;
  /** embedding 当前展开（非 useMain）时对应 kind 的凭证（与 qwen 桶共享） */
  embeddingCredential: ProviderCredentialView;
  onEmbeddingCredentialChange: (patch: Partial<{ apiKey: string; baseURL: string }>) => void;
  settings: MemorySettings;
  onSettingsChange: (next: MemorySettings) => void;
}

function isUseMainRef(v: unknown): v is { useMain: true } {
  return !!v && typeof v === 'object' && (v as { useMain?: boolean }).useMain === true;
}

export function MemoryTab(props: MemoryTabProps) {
  const {
    main,
    mainCredential,
    aux,
    onAuxChange,
    auxCredential,
    onAuxCredentialChange,
    embedding,
    onEmbeddingChange,
    embeddingCredential,
    onEmbeddingCredentialChange,
    settings,
    onSettingsChange,
  } = props;

  // aux 的 fallback：kind 继承主 Provider（方便"关掉 useMain 时自然回到主 kind"）
  // 两家思考开关形态不同，按 kind 分路透：
  //  - qwen     → `enableThinking: boolean`
  //  - deepseek → `thinking: 'enabled' | 'disabled'`
  const auxFallback: LLMProviderConfig =
    main.kind === 'qwen'
      ? {
          kind: 'qwen',
          model: main.model,
          ...(typeof main.enableThinking === 'boolean'
            ? { enableThinking: main.enableThinking }
            : {}),
        }
      : {
          kind: 'deepseek',
          model: main.model,
          thinking: main.thinking ?? 'enabled',
        };

  // embedding fallback：kind 固定 qwen-embedding
  const embeddingFallback: EmbeddingProviderConfig = {
    ...DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK,
  };

  /** 主 Provider 是否无 embedding 能力（如 DeepSeek）且用户仍 useMain */
  const mainEntry = PROVIDER_REGISTRY[main.kind];
  const mainLacksEmbedding = mainEntry?.embedding === null;
  const embeddingUseMain = isUseMainRef(embedding);
  const showComboWarning = mainLacksEmbedding && embeddingUseMain;

  const handleApplyRecommendedEmbedding = () => {
    // 推荐：Qwen text-embedding-v3 / 1024 维，apiKey 走 qwen 桶（用户需另行填写）
    onEmbeddingChange({
      kind: 'qwen-embedding',
      model: 'text-embedding-v3',
      dimension: 1024,
    });
  };

  // 辅助表单的凭证视图：useMain=true 时显示主凭证；否则显示 aux kind 对应凭证
  const auxCredView: ProviderCredentialView = isUseMainRef(aux) ? mainCredential : auxCredential;
  // embedding 表单同理：useMain=true 显示主凭证；自定义时显示 qwen 桶凭证
  const embCredView: ProviderCredentialView = isUseMainRef(embedding)
    ? mainCredential
    : embeddingCredential;

  return (
    <>
      <Alert
        type="info"
        showIcon
        message="记忆层（v0.2）"
        description={
          <>
            四层记忆：Persona（Agent 长期指令）/ Episodic（事件）/ SessionTopic（情景）/ WorkingMemory（工作）。
            辅助 Provider 用于话题识别、反思归纳、Intent 精判；Embedding Provider 用于事件召回的向量化。
            默认都复用主 Provider 配置，按需单独配置更便宜的模型。
          </>
        }
        style={{ marginBottom: 16 }}
      />

      <Card title="辅助 Provider（话题识别 / 反思 / Intent 精判）" style={{ marginBottom: 16 }}>
        <Form layout="vertical" requiredMark={false}>
          <ProviderConfigForm<LLMProviderConfig>
            mode="llm"
            value={aux}
            onChange={onAuxChange}
            fallback={auxFallback}
            credential={auxCredView}
            onCredentialChange={(patch) => {
              const kind = isUseMainRef(aux) ? main.kind : aux.kind;
              onAuxCredentialChange(kind, patch);
            }}
            hint="辅助模型的调用次数较高，建议选择便宜的模型（如 qwen-turbo / deepseek-v4-flash）。"
          />
        </Form>
      </Card>

      <Card title="Embedding Provider（向量召回）" style={{ marginBottom: 16 }}>
        {showComboWarning ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`当前主 Provider 为 ${mainEntry?.displayName ?? main.kind}，其未提供 embedding 服务`}
            description={
              <>
                向量召回依赖 embedding，推荐切换到 <strong>Qwen text-embedding-v3</strong>
                （与主对话解耦，不影响聊天质量）。
                <div style={{ marginTop: 8 }}>
                  <Button size="small" type="primary" onClick={handleApplyRecommendedEmbedding}>
                    一键使用推荐配置
                  </Button>
                </div>
              </>
            }
          />
        ) : null}
        <Form layout="vertical" requiredMark={false}>
          <ProviderConfigForm<EmbeddingProviderConfig>
            mode="embedding"
            value={embedding}
            onChange={onEmbeddingChange}
            fallback={embeddingFallback}
            credential={embCredView}
            onCredentialChange={onEmbeddingCredentialChange}
            hint="向量模型维度与模型绑定；切换后必须清库重建。Embedding 暂仅支持 Qwen（DeepSeek 官方无 embedding 服务）。"
          />
        </Form>
      </Card>

      <Card title="记忆行为" style={{ marginBottom: 16 }}>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item
            label="敏感信息过滤"
            extra="写入 IndexedDB 前替换 email / 手机号 / 身份证 / API Key / 信用卡号为占位符。强烈建议开启。"
          >
            <Switch
              checked={settings.sensitiveFilterEnabled}
              onChange={(v) => onSettingsChange({ ...settings, sensitiveFilterEnabled: v })}
            />
          </Form.Item>

          <Form.Item
            label="反思 Job"
            extra="PageVisit 结束后异步生成 visit_summary、归纳 Agent 长期指令候选；关闭后记忆不再沉淀。"
          >
            <Switch
              checked={settings.reflectionEnabled}
              onChange={(v) => onSettingsChange({ ...settings, reflectionEnabled: v })}
            />
          </Form.Item>

          <Form.Item
            label="WorkingMemory 软 TTL（天）"
            extra="超过该时长未访问的工作记忆会被归档（不立即删）。"
          >
            <InputNumber
              min={1}
              max={365}
              value={settings.workingMemoryTtlDays}
              onChange={(v) =>
                onSettingsChange({ ...settings, workingMemoryTtlDays: Number(v) || 30 })
              }
              style={{ width: 140 }}
            />
          </Form.Item>

          <Form.Item
            label="长期指令自动采纳阈值"
            extra="反思命中同一条长期指令达到该次数时自动标记为 confirmed；其余 candidate 需用户确认。"
          >
            <InputNumber
              min={1}
              max={10}
              value={settings.personaAutoConfirmHits}
              onChange={(v) =>
                onSettingsChange({ ...settings, personaAutoConfirmHits: Number(v) || 3 })
              }
              style={{ width: 140 }}
            />
          </Form.Item>
        </Form>
      </Card>
    </>
  );
}
