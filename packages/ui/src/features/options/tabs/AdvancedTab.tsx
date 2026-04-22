/**
 * AdvancedTab · 高级配置
 * ---------------------------------------------
 * 目前仅一项：Agent Loop maxTurns（3~15，默认 8）
 * 未来还可以放：上下文截断策略、请求超时、调试开关等。
 */
import { Alert, Card, Form, InputNumber, Typography } from 'antd';
import {
  MAX_TURNS_MAX,
  MAX_TURNS_MIN,
  clampMaxTurns,
  type ChatSettings,
} from '@doc-assistant/shared';

export interface AdvancedTabProps {
  chat: ChatSettings;
  onChatChange: (next: ChatSettings) => void;
}

export function AdvancedTab({ chat, onChatChange }: AdvancedTabProps) {
  return (
    <>
      <Alert
        type="info"
        showIcon
        message="高级配置"
        description="这些选项影响 Agent 的行为与稳定性，修改前建议先了解其影响。"
        style={{ marginBottom: 16 }}
      />

      <Card title="Agent Loop">
        <Form layout="vertical" requiredMark={false}>
          <Form.Item
            label={`最大工具调用轮数：${chat.maxTurns}`}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                允许 Agent 在一次回答中最多进行多少轮「调用工具 → 基于结果继续思考」的循环。
                范围 [{MAX_TURNS_MIN}, {MAX_TURNS_MAX}]，默认 8。
                最后一轮会强制不传 tools 以避免调用悬空（见 loop.ts 兜底）。
              </Typography.Text>
            }
          >
            <InputNumber
              min={MAX_TURNS_MIN}
              max={MAX_TURNS_MAX}
              value={chat.maxTurns}
              onChange={(v) => onChatChange({ ...chat, maxTurns: clampMaxTurns(v) })}
              style={{ width: 140 }}
            />
          </Form.Item>
        </Form>
      </Card>
    </>
  );
}
