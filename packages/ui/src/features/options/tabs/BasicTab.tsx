/**
 * BasicTab · 基础配置
 * ---------------------------------------------
 * 职责：
 * - 主 Provider 配置（kind 可选 qwen / deepseek / ...；baseURL + model + apiKey + enableThinking）
 * - 测试连接（轻量 fetch）
 * - 拉取账号可用模型列表（走 registry.listModels）
 * - 通用对话设置（systemPrompt + maxContextChars）
 *
 * v0.6.0-beta.2：
 * - Provider 下拉、默认 baseURL、listModels 函数全部从 `PROVIDER_REGISTRY` 读
 * - 切换 kind 时：apiKey 保留；baseURL 若等于旧 kind 的默认值则替换为新 kind 默认值，
 *   否则保留；model 替换为新 kind 的默认 model
 * - 拉取到的模型是 `GenericModelListItem`（跨 Provider 统一结构）
 */
import {
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  Select,
  Slider,
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
  type ChatSettings,
  type LLMProviderConfig,
  type ProviderKind,
} from '@doc-assistant/shared';
import {
  PROVIDER_REGISTRY,
  listProviderEntries,
  type GenericModelKind,
  type GenericModelListItem,
} from '@doc-assistant/provider';
import { splitSnapshots } from '../model-list-helpers';

const logger = createLogger('ui:options:basic');

/** 非 chat 类模型的 Tag 颜色（与 antd Tag 内置色对齐） */
const KIND_TAG_COLOR: Record<GenericModelKind, string> = {
  chat: 'default',
  embedding: 'geekblue',
  rerank: 'purple',
  vision: 'magenta',
  audio: 'orange',
  image: 'volcano',
  other: 'default',
};

export interface BasicTabProps {
  main: LLMProviderConfig;
  onMainChange: (next: LLMProviderConfig) => void;
  chat: ChatSettings;
  onChatChange: (next: ChatSettings) => void;
}

export function BasicTab({ main, onMainChange, chat, onChatChange }: BasicTabProps) {
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<GenericModelListItem[] | null>(null);
  const [showAllKinds, setShowAllKinds] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [searchText, setSearchText] = useState('');
  const keyMask = useMemo(() => maskSecret(main.apiKey), [main.apiKey]);

  /** 切换 Provider kind：按 registry 默认值替换 baseURL/model，保留 apiKey */
  const handleKindChange = (nextKind: ProviderKind) => {
    const currentEntry = PROVIDER_REGISTRY[main.kind];
    const nextEntry = PROVIDER_REGISTRY[nextKind];
    if (!nextEntry) return;
    // 如果当前 baseURL 是旧 kind 的默认值，替换为新默认值；否则保留用户自定义
    const replaceBaseURL =
      currentEntry && main.baseURL === currentEntry.defaultConfig.baseURL;
    const nextThinking =
      nextEntry.defaultConfig.enableThinking ?? main.enableThinking ?? false;
    onMainChange({
      ...main,
      kind: nextKind,
      ...(replaceBaseURL ? { baseURL: nextEntry.defaultConfig.baseURL } : {}),
      model: nextEntry.defaultConfig.model,
      enableThinking: nextThinking,
    });
    // 切换 kind 后清空模型列表缓存（账号不一定对新端点生效）
    setFetchedModels(null);
    setSearchText('');
  };

  const handleTestConnection = async () => {
    if (!main.apiKey || !main.baseURL || !main.model) {
      message.error('请先填写完整的 API Key / Base URL / 模型');
      return;
    }
    setTesting(true);
    logger.info('测试连接中', {
      kind: main.kind,
      baseURL: main.baseURL,
      model: main.model,
      apiKey: keyMask,
    });
    try {
      const resp = await fetch(`${main.baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${main.apiKey}`,
        },
        body: JSON.stringify({
          model: main.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      });
      if (resp.ok) {
        message.success('连接成功');
      } else {
        const text = await resp.text().catch(() => '');
        message.error(`连接失败：HTTP ${resp.status} ${text.slice(0, 200)}`);
      }
    } catch (err) {
      logger.error('测试连接失败', (err as Error).message);
      message.error(`连接失败：${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleFetchModels = async () => {
    if (!main.apiKey || !main.baseURL) {
      message.error('请先填写 API Key 与 Base URL');
      return;
    }
    setFetchingModels(true);
    try {
      const entry = PROVIDER_REGISTRY[main.kind];
      if (!entry) {
        message.error(`未知的 Provider kind: ${main.kind}`);
        return;
      }
      const all = await entry.listModels({
        apiKey: main.apiKey,
        baseURL: main.baseURL,
      });
      setFetchedModels(all);
      const chatCount = all.filter((m) => m.kind === 'chat').length;
      logger.info('拉取模型列表成功', {
        kind: main.kind,
        total: all.length,
        chat: chatCount,
        apiKey: keyMask,
      });
      message.success(`已拉取 ${all.length} 个模型（其中 ${chatCount} 个对话模型）`);
    } catch (err) {
      logger.error('拉取模型列表失败', (err as Error).message);
      message.error(`拉取失败：${(err as Error).message}`);
    } finally {
      setFetchingModels(false);
    }
  };

  const providerEntry = PROVIDER_REGISTRY[main.kind];
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
    stats: { total: number; chat: number; snapshotHidden: number };
  }>(() => {
    if (!fetchedModels || fetchedModels.length === 0) {
      const fallback = providerEntry?.suggestedModels ?? [];
      return {
        options: fallback.map((m) => ({ value: m, label: m })),
        stats: { total: 0, chat: 0, snapshotHidden: 0 },
      };
    }

    const byKind = showAllKinds
      ? fetchedModels
      : fetchedModels.filter((m) => m.kind === 'chat');

    const { primary, snapshotCount } = splitSnapshots(byKind);
    const base = showSnapshots ? byKind : primary;

    const needle = searchText.trim().toLowerCase();
    const filtered = needle
      ? base.filter((m) => m.id.toLowerCase().includes(needle))
      : base;

    return {
      options: filtered.map((m) => ({
        value: m.id,
        label: (
          <Space size={6}>
            <span>{m.id}</span>
            {showAllKinds && m.kind !== 'chat' ? (
              <Tag color={KIND_TAG_COLOR[m.kind]} style={{ marginInlineEnd: 0 }}>
                {m.kind}
              </Tag>
            ) : null}
            {m.capability ? (
              <Tooltip
                title={`context ≈ ${m.capability.contextWindow} tokens${m.capability.supportsReasoning ? ' · 支持思考' : ''}${m.capability.supportsTools ? ' · 支持工具' : ''}`}
              >
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                  已知能力
                </Tag>
              </Tooltip>
            ) : null}
          </Space>
        ),
      })),
      stats: {
        total: fetchedModels.length,
        chat: fetchedModels.filter((m) => m.kind === 'chat').length,
        snapshotHidden: snapshotCount,
      },
    };
  }, [fetchedModels, providerEntry, showAllKinds, showSnapshots, searchText]);

  const modelPlaceholder = (() => {
    const suggested = providerEntry?.suggestedModels ?? [];
    if (suggested.length === 0) return '输入模型名';
    const head = suggested.slice(0, 2).join(' / ');
    return `如 ${head}`;
  })();

  return (
    <>
      <Card title="大模型服务（主对话）" style={{ marginBottom: 16 }}>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Provider">
            <Select
              value={main.kind}
              onChange={(v: ProviderKind) => handleKindChange(v)}
              options={providerOptions}
            />
            {providerEntry?.description ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {providerEntry.description}
              </Typography.Text>
            ) : null}
          </Form.Item>

          <Form.Item
            label="API Key"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                存储位置：chrome.storage.local（仅本机）。日志中将脱敏显示为
                <code style={{ marginLeft: 4 }}>{keyMask || '****'}</code>。
              </Typography.Text>
            }
          >
            <Input.Password
              value={main.apiKey}
              onChange={(e) => onMainChange({ ...main, apiKey: e.target.value })}
              placeholder="sk-..."
              autoComplete="off"
            />
          </Form.Item>

          <Form.Item
            label="Base URL"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                当前 Provider 的 OpenAI 兼容端点；如无特殊需求保持默认。
                <br />
                v0.4.0 起扩展已放开 <code>host_permissions: &lt;all_urls&gt;</code>
                ，可填任意 OpenAI 兼容 baseURL（自托管 / Anthropic / OpenAI
                等）。除你配置的 baseURL 外，插件不向其它域发请求；详见仓库 <code>docs/PRIVACY.md</code>。
              </Typography.Text>
            }
          >
            <Input
              value={main.baseURL}
              onChange={(e) => onMainChange({ ...main, baseURL: e.target.value })}
            />
          </Form.Item>

          <Form.Item
            label="模型"
            extra={
              fetchedModels
                ? `列表来自账号 /models 接口（总 ${stats.total} 个；${stats.chat} 个对话模型${stats.snapshotHidden && !showSnapshots ? `；隐藏 ${stats.snapshotHidden} 个历史快照` : ''}）。支持手动输入自定义模型名。`
                : '默认显示常用建议值；点击右侧「拉取可用模型」可获取账号下实际可用的完整列表。'
            }
          >
            <Space.Compact style={{ width: '100%' }}>
              <AutoComplete
                value={main.model}
                onChange={(v) => onMainChange({ ...main, model: v })}
                onSearch={setSearchText}
                options={modelOptions}
                placeholder={modelPlaceholder}
                style={{ flex: 1 }}
                filterOption={false}
                allowClear
              />
              <Button onClick={handleFetchModels} loading={fetchingModels}>
                拉取可用模型
              </Button>
            </Space.Compact>
            {fetchedModels ? (
              <div style={{ marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <Space size={6}>
                  <Switch
                    size="small"
                    checked={showAllKinds}
                    onChange={setShowAllKinds}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    显示全部类型（embedding / vision / audio / ...）
                  </Typography.Text>
                </Space>
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

          <Form.Item
            label="启用思考模式（reasoning_content）"
            extra="开启后助手会流式返回思考过程；具体效果取决于所选模型是否支持（如 qwen3 系列 / deepseek-reasoner）。"
          >
            <Switch
              checked={!!main.enableThinking}
              onChange={(v) => onMainChange({ ...main, enableThinking: v })}
            />
          </Form.Item>

          <Space>
            <Button onClick={handleTestConnection} loading={testing}>
              测试连接
            </Button>
          </Space>
        </Form>
      </Card>

      <Card title="对话行为" style={{ marginBottom: 16 }}>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="默认系统提示词">
            <Input.TextArea
              rows={4}
              value={chat.systemPrompt}
              onChange={(e) => onChatChange({ ...chat, systemPrompt: e.target.value })}
            />
          </Form.Item>

          <Form.Item
            label={`上下文字符上限：${chat.maxContextChars}`}
            extra="粗略按字符估算；触发阈值后较早的消息与页面内容将被截断或摘要。"
          >
            <Slider
              min={1000}
              max={32000}
              step={500}
              value={chat.maxContextChars}
              onChange={(v) => onChatChange({ ...chat, maxContextChars: v })}
            />
          </Form.Item>
        </Form>
      </Card>
    </>
  );
}
