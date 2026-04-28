/**
 * BasicTab · 基础配置
 * ---------------------------------------------
 * 职责：
 * - 主 Provider 配置（kind=qwen；baseURL + model + apiKey + enableThinking）
 * - 测试连接（轻量 fetch）
 * - **拉取账号可用模型列表**（调用 listQwenModels）—— v0.2.1 新增
 * - 通用对话设置（systemPrompt + maxContextChars）
 *
 * v0.2 新增：maxTurns 放到 AdvancedTab，这里只管主对话必备项。
 *
 * 拉取模型设计要点：
 * - 结果**不持久化**，只存 React state；每次打开 Options 页重新拉
 * - **默认过滤策略（双层）**：
 *   1. 只显示 chat 类模型（「显示全部类型」可打开）
 *   2. 隐藏快照版本（形如 `qwen-plus-2025-07-14` / `-latest`，主干在列表里）—— 开关可展开
 * - **下拉展开默认显示全量**：`filterOption` 只在用户主动搜索时生效，而不是在 value 命中输入框时过滤
 *   （AutoComplete 默认会把 value 当 search term，用户看到的列表会被当前选中模型过滤成"只有变种"，反直觉）
 * - AutoComplete 允许自由输入模型名；拉取失败**不阻塞**，回退到固定 QWEN_MODELS 建议值
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
  QWEN_MODELS,
  createLogger,
  maskSecret,
  type ChatSettings,
  type LLMProviderConfig,
} from '@doc-assistant/shared';
import { listQwenModels, type QwenModelListItem, type QwenModelKind } from '@doc-assistant/provider';
import { splitSnapshots } from '../model-list-helpers';

const logger = createLogger('ui:options:basic');

/** 非 chat 类模型的 Tag 颜色（与 antd Tag 内置色对齐） */
const KIND_TAG_COLOR: Record<QwenModelKind, string> = {
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
  /** 拉取到的完整模型列表（含各种 kind）。null = 尚未拉过，走 QWEN_MODELS 默认建议 */
  const [fetchedModels, setFetchedModels] = useState<QwenModelListItem[] | null>(null);
  /** 是否显示非 chat 类的模型（默认只显示 chat；打开后显示全部，用 Tag 标出 kind） */
  const [showAllKinds, setShowAllKinds] = useState(false);
  /** 是否显示历史快照版本（qwen-plus-2025-07-14 / -latest 等） */
  const [showSnapshots, setShowSnapshots] = useState(false);
  /**
   * AutoComplete 的搜索词（独立于 value）
   * ---------------------------------------------
   * AutoComplete 默认把 value 作为 search；用户刚点开下拉框时 value=选中的模型，
   * 会导致 filterOption 把列表过滤成"只含当前模型子串的行"—— 用户以为列表残缺。
   * 方案：用独立 searchText，通过 onSearch 仅在用户主动输入时更新。
   */
  const [searchText, setSearchText] = useState('');
  const keyMask = useMemo(() => maskSecret(main.apiKey), [main.apiKey]);

  const handleTestConnection = async () => {
    if (!main.apiKey || !main.baseURL || !main.model) {
      message.error('请先填写完整的 API Key / Base URL / 模型');
      return;
    }
    setTesting(true);
    logger.info('测试连接中', { baseURL: main.baseURL, model: main.model, apiKey: keyMask });
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
      const all = await listQwenModels({
        apiKey: main.apiKey,
        baseURL: main.baseURL,
      });
      setFetchedModels(all);
      const chatCount = all.filter((m) => m.kind === 'chat').length;
      logger.info('拉取模型列表成功', {
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

  // 下拉选项（三层过滤 + 折叠快照）：
  // 1. kind 过滤：showAllKinds=false 时只保留 chat
  // 2. 快照折叠：showSnapshots=false 时仅保留主干 alias
  // 3. 搜索过滤：仅当 searchText 非空时生效（防止 AutoComplete 用 value 当搜索词造成列表"残缺错觉"）
  const { options: modelOptions, stats } = useMemo<{
    options: Array<{ value: string; label: ReactNode }>;
    stats: { total: number; chat: number; snapshotHidden: number };
  }>(() => {
    // 未拉取：固定建议值
    if (!fetchedModels || fetchedModels.length === 0) {
      return {
        options: QWEN_MODELS.map((m) => ({ value: m, label: m })),
        stats: { total: 0, chat: 0, snapshotHidden: 0 },
      };
    }

    // step1: kind 过滤
    const byKind = showAllKinds
      ? fetchedModels
      : fetchedModels.filter((m) => m.kind === 'chat');

    // step2: 快照折叠
    const { primary, snapshotCount } = splitSnapshots(byKind);
    const base = showSnapshots ? byKind : primary;

    // step3: 搜索过滤（受控，避免 AutoComplete 默认用 value 过滤）
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
  }, [fetchedModels, showAllKinds, showSnapshots, searchText]);

  return (
    <>
      <Card title="大模型服务（主对话）" style={{ marginBottom: 16 }}>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Provider">
            <Select
              value={main.kind}
              onChange={(v) => onMainChange({ ...main, kind: v })}
              options={[{ label: '千问 Qwen（阿里云百炼）', value: 'qwen' }]}
            />
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

          <Form.Item label="Base URL" extra="千问的 OpenAI 兼容端点；如无特殊需求保持默认。">
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
                placeholder="选择或输入模型名"
                style={{ flex: 1 }}
                // 过滤完全交给 useMemo 里的 searchText，这里关掉 AutoComplete 内置行为
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
            extra="开启后助手会流式返回思考过程；部分模型需要 qwen3 系列才能生效。"
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

