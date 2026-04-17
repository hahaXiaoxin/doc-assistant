/**
 * MessageList · 消息流容器
 * ---------------------------------------------
 * - 自动滚动到底部
 * - 展示 messages + 当前 streaming（如存在）
 */
import { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { MessageBubble } from '../../components/MessageBubble';
import { ThinkingBlock } from '../../components/ThinkingBlock';
import { tokens } from '../../theme/tokens';
import type {
  StreamingAssistantMessage,
  UIMessage,
} from '../../hooks/useStreamingChat';

const Wrap = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 12px;
  overflow-y: auto;
`;

const Empty = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: ${tokens.color.textTertiary};
  font-size: ${tokens.font.sizeSmall};
  padding: 48px 24px;
  text-align: center;
`;

const Pill = styled.div`
  padding: 4px 10px;
  border-radius: ${tokens.radius.pill};
  background: ${tokens.color.bgThinking};
  color: ${tokens.color.primaryActive};
  font-size: ${tokens.font.sizeSmall};
  font-weight: 500;
`;

export interface MessageListProps {
  messages: UIMessage[];
  streaming: StreamingAssistantMessage | null;
}

export function MessageList({ messages, streaming }: MessageListProps) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming?.text, streaming?.reasoning]);

  if (!messages.length && !streaming) {
    return (
      <Wrap ref={wrapRef}>
        <Empty>
          <Pill>v0.1 MVP</Pill>
          <div style={{ fontWeight: 600, color: tokens.color.textSecondary }}>
            向当前页面提问吧
          </div>
          <div>可输入 /new 清空上下文；可划词后插入引用</div>
        </Empty>
      </Wrap>
    );
  }

  return (
    <Wrap ref={wrapRef}>
      {messages.map((m) => (
        <div key={m.id}>
          {m.reasoning && (
            <ThinkingBlock
              content={m.reasoning}
              streaming={false}
              {...(typeof m.reasoningElapsedMs === 'number'
                ? { elapsedMs: m.reasoningElapsedMs }
                : {})}
            />
          )}
          <MessageBubble role={m.role} content={m.content} {...(m.error ? { error: true } : {})} />
        </div>
      ))}
      {streaming && (
        <div>
          {(streaming.reasoning || streaming.streaming) && streaming.reasoning && (
            <ThinkingBlock
              content={streaming.reasoning}
              streaming={streaming.streaming}
              {...(typeof streaming.thinkingElapsedMs === 'number'
                ? { elapsedMs: streaming.thinkingElapsedMs }
                : {})}
            />
          )}
          <MessageBubble
            role="assistant"
            content={streaming.text || (streaming.error ? `⚠ ${streaming.error}` : ' ')}
            streaming={streaming.streaming}
            {...(streaming.error ? { error: true } : {})}
          />
        </div>
      )}
    </Wrap>
  );
}
