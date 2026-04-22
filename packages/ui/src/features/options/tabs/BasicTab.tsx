/**
 * BasicTab · 基础配置
 * ---------------------------------------------
 * 职责：
 * - 主 Provider 配置（kind=qwen；baseURL + model + apiKey + enableThinking）
 * - 测试连接（轻量 fetch）
 * - 通用对话设置（systemPrompt + maxContextChars）
 *
 * v0.2 新增：maxTurns 放到 AdvancedTab，这里只管主对话必备项。
 */
import {
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
import { useMemo, useState } from 'react';
import {
  QWEN_MODELS,
  createLogger,
  maskSecret,
  type ChatSettings,
  type LLMProviderConfig,
} from '@doc-assistant/shared';

const logger = createLogger('ui:options:basic');

export interface BasicTabProps {
  main: LLMProviderConfig;
  onMainChange: (next: LLMProviderConfig) => void;
  chat: ChatSettings;
  onChatChange: (next: ChatSettings) => void;
}

export function BasicTab({ main, onMainChange, chat, onChatChange }: BasicTabProps) {
  const [testing, setTesting] = useState(false);
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

          <Form.Item label="模型">
            <Select
              value={main.model}
              onChange={(v) => onMainChange({ ...main, model: v })}
              showSearch
              options={QWEN_MODELS.map((m) => ({ label: m, value: m }))}
            />
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
