/**
 * 配置表单 · Ant Design 后台风格
 * ---------------------------------------------
 * 职责：
 * - 为当前选中的 Provider（MVP 仅千问）渲染对应字段
 * - 使用 zod 校验：apiKey 非空、baseURL 是合法 URL、model 非空
 * - 保存到 chrome.storage.local（通过注入的 TypedStorage）
 * - 测试连接（轻量 fetch baseURL 验证，不暴露 key 到日志）
 *
 * 交互：
 * - 底部吸附保存栏（Save / Reset）
 * - 保存成功 antd message 提示
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Select,
  Slider,
  Space,
  Switch,
  Typography,
  message,
} from 'antd';
import { z } from 'zod';
import {
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_QWEN_CONFIG,
  QWEN_MODELS,
  STORAGE_KEYS,
  type ChatSettings,
  type ProviderKind,
  type QwenConfig,
  type StorageSchema,
  type TypedStorage,
  createLogger,
  maskSecret,
} from '@doc-assistant/shared';

const logger = createLogger('ui:options');

const qwenSchema = z.object({
  apiKey: z.string().trim().min(1, '请填写 API Key'),
  baseURL: z.string().trim().url('请输入合法的 URL'),
  model: z.string().trim().min(1, '请选择模型'),
  enableThinking: z.boolean(),
});

const chatSettingsSchema = z.object({
  systemPrompt: z.string().trim().min(1, '系统提示词不能为空'),
  maxContextChars: z.number().int().min(1000).max(32000),
});

export interface OptionsFormProps {
  storage: TypedStorage<StorageSchema>;
}

export function OptionsForm({ storage }: OptionsFormProps) {
  const [provider, setProvider] = useState<ProviderKind>('qwen');
  const [qwen, setQwen] = useState<QwenConfig>(DEFAULT_QWEN_CONFIG);
  const [chat, setChat] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const keyMask = useMemo(() => maskSecret(qwen.apiKey), [qwen.apiKey]);

  useEffect(() => {
    void (async () => {
      const [p, q, c] = await Promise.all([
        storage.get(STORAGE_KEYS.ACTIVE_PROVIDER),
        storage.get(STORAGE_KEYS.QWEN_CONFIG),
        storage.get(STORAGE_KEYS.CHAT_SETTINGS),
      ]);
      if (p) setProvider(p);
      if (q) setQwen({ ...DEFAULT_QWEN_CONFIG, ...q });
      if (c) setChat({ ...DEFAULT_CHAT_SETTINGS, ...c });
      setLoading(false);
    })();
  }, [storage]);

  const handleSave = async () => {
    const qwenResult = qwenSchema.safeParse(qwen);
    if (!qwenResult.success) {
      message.error(qwenResult.error.errors[0]?.message ?? '千问配置校验失败');
      return;
    }
    const chatResult = chatSettingsSchema.safeParse(chat);
    if (!chatResult.success) {
      message.error(chatResult.error.errors[0]?.message ?? '对话设置校验失败');
      return;
    }

    setSaving(true);
    try {
      await storage.setMany({
        [STORAGE_KEYS.ACTIVE_PROVIDER]: provider,
        [STORAGE_KEYS.QWEN_CONFIG]: qwen,
        [STORAGE_KEYS.CHAT_SETTINGS]: chat,
      });
      logger.info('配置已保存', {
        provider,
        model: qwen.model,
        enableThinking: qwen.enableThinking,
        apiKey: keyMask,
      });
      message.success('配置已保存');
    } catch (err) {
      console.error('[ui:options] 保存失败', err);
      message.error(`保存失败：${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setQwen(DEFAULT_QWEN_CONFIG);
    setChat(DEFAULT_CHAT_SETTINGS);
    message.info('已重置为默认值（未保存）');
  };

  /**
   * 连接性测试：发一个极短的非流式请求，验证 apiKey + baseURL + model 三元组。
   * 不打印 apiKey，只打印 mask。
   */
  const handleTestConnection = async () => {
    const qwenResult = qwenSchema.safeParse(qwen);
    if (!qwenResult.success) {
      message.error(qwenResult.error.errors[0]?.message ?? '请先填写完整配置');
      return;
    }
    setTesting(true);
    logger.info('测试连接中', { baseURL: qwen.baseURL, model: qwen.model, apiKey: keyMask });
    try {
      const resp = await fetch(`${qwen.baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${qwen.apiKey}`,
        },
        body: JSON.stringify({
          model: qwen.model,
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
      console.error('[ui:options] 测试连接失败', err);
      message.error(`连接失败：${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#8c8c8c' }}>正在加载配置…</div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 24px 96px' }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Doc Assistant · 配置
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        所有配置仅保存在本地浏览器（chrome.storage.local），不会上传任何服务器。
      </Typography.Paragraph>

      {/* Provider 区块 */}
      <Card title="大模型服务" style={{ marginBottom: 16 }}>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Provider">
            <Select
              value={provider}
              onChange={setProvider}
              options={[{ label: '千问 Qwen（阿里云百炼）', value: 'qwen' }]}
            />
          </Form.Item>

          {provider === 'qwen' && (
            <>
              <Form.Item
                label="API Key"
                extra={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    存储位置：chrome.storage.local（仅本机）。保存后日志中将脱敏显示为
                    <code style={{ marginLeft: 4 }}>{keyMask || '****'}</code>。
                  </Typography.Text>
                }
              >
                <Input.Password
                  value={qwen.apiKey}
                  onChange={(e) => setQwen({ ...qwen, apiKey: e.target.value })}
                  placeholder="sk-..."
                  autoComplete="off"
                />
              </Form.Item>

              <Form.Item
                label="Base URL"
                extra="千问的 OpenAI 兼容端点；如无特殊需求保持默认。"
              >
                <Input
                  value={qwen.baseURL}
                  onChange={(e) => setQwen({ ...qwen, baseURL: e.target.value })}
                />
              </Form.Item>

              <Form.Item label="模型">
                <Select
                  value={qwen.model}
                  onChange={(v) => setQwen({ ...qwen, model: v })}
                  showSearch
                  options={QWEN_MODELS.map((m) => ({ label: m, value: m }))}
                />
              </Form.Item>

              <Form.Item
                label="启用思考模式（reasoning_content）"
                extra="开启后助手会流式返回思考过程；部分模型需要 qwen3 系列才能生效。"
              >
                <Switch
                  checked={qwen.enableThinking}
                  onChange={(v) => setQwen({ ...qwen, enableThinking: v })}
                />
              </Form.Item>

              <Space>
                <Button onClick={handleTestConnection} loading={testing}>
                  测试连接
                </Button>
              </Space>
            </>
          )}
        </Form>
      </Card>

      {/* 对话行为 */}
      <Card title="对话行为" style={{ marginBottom: 16 }}>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="默认系统提示词">
            <Input.TextArea
              rows={4}
              value={chat.systemPrompt}
              onChange={(e) => setChat({ ...chat, systemPrompt: e.target.value })}
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
              onChange={(v) => setChat({ ...chat, maxContextChars: v })}
            />
          </Form.Item>
        </Form>
      </Card>

      {/* 关于 */}
      <Card title="关于">
        <Alert
          type="info"
          showIcon
          message="当前版本：v0.1（MVP）"
          description="记忆层、OCR、向量召回、云同步等能力已在 docs/ROADMAP.md 中规划。MVP 版本对话记录仅保留在当前窗口，刷新页面后丢失，这是预期行为。"
        />
      </Card>

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
