/**
 * MessageList · 消息流容器
 * ---------------------------------------------
 * v1.1 PR-3 C4:
 * - a11y: role="log" + aria-live="polite" 让屏幕阅读器在新消息到达时朗读。
 * - 滚动感知: 用户手动上滚 > 80px 时暂停自动贴底;继续流式新消息到来时
 *   右下角显示"↓ 新消息"悬浮按钮,点击平滑滚到底 + 恢复 autoscroll。
 *   新消息时给按钮加 `+N` 徽标,直接告诉用户积累了多少条。
 * - done TODO 双通道(颜色+中划线)已在 WorkingMemoryCard 内。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { MessageBubble } from '../../components/MessageBubble';
import { ThinkingBlock } from '../../components/ThinkingBlock';
import { tokens } from '../../theme/tokens';
import type {
  StreamingAssistantMessage,
  UIMessage,
} from '../../hooks/useStreamingChat';

/** 用户上滚多少 px 才算"离底"—— 小于此阈值仍自动贴底 */
const NEAR_BOTTOM_PX = 80;

const Wrap = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 12px;
  overflow-y: auto;
  position: relative;
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

/**
 * "↓ 新消息"浮标:
 * - position: sticky 于 Wrap 底部 ——不被消息流推出去,也不会挡住头部。
 * - 只在用户上滚后出现;流式新内容进来时显示徽标 +N。
 */
const ScrollToBottomHost = styled.div`
  position: sticky;
  bottom: 8px;
  align-self: center;
  pointer-events: none;
  /** 需要高于气泡 · 不遮头 */
  z-index: 2;
`;

const ScrollToBottomButton = styled.button`
  all: unset;
  cursor: pointer;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: ${tokens.radius.pill};
  background: ${tokens.color.bgPanel};
  color: ${tokens.color.textPrimary};
  font-size: ${tokens.font.sizeSmall};
  font-weight: 500;
  box-shadow: ${tokens.shadow.card};
  border: 1px solid ${tokens.color.border};
  transition: background ${tokens.motion.fast}, transform ${tokens.motion.fast};

  &:hover {
    background: ${tokens.color.bgWhite};
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: 2px solid ${tokens.color.primary};
    outline-offset: 2px;
  }
`;

const Badge = styled.span`
  display: inline-block;
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: ${tokens.radius.pill};
  background: ${tokens.color.danger};
  color: ${tokens.color.textInverse};
  font-size: 11px;
  line-height: 16px;
  text-align: center;
`;

export interface MessageListProps {
  messages: UIMessage[];
  streaming: StreamingAssistantMessage | null;
}

export function MessageList({ messages, streaming }: MessageListProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  /**
   * 用户是否"离底"—— true 时暂停 autoscroll。
   * 初始 false(贴底)。onScroll 里基于 scrollTop/clientHeight/scrollHeight 更新。
   */
  const [stickyAtBottom, setStickyAtBottom] = useState(true);
  /** 用户上滚期间,后续进来的 assistant 消息 / streaming tick 累计数。 */
  const [pendingCount, setPendingCount] = useState(0);
  /** 上一次渲染的 streaming text 长度 · 用于检测"新内容到来" */
  const lastStreamingLenRef = useRef(0);
  const lastMsgCountRef = useRef(messages.length);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = wrapRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // 监听用户滚动,更新 stickyAtBottom
  const onScroll = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    const near = distanceFromBottom <= NEAR_BOTTOM_PX;
    setStickyAtBottom(near);
    if (near) {
      // 用户主动回到底部就清零徽标
      setPendingCount(0);
    }
  }, []);

  // 新消息 / 流式内容到来时:
  // - 如果仍贴底 → 自动滚到底;
  // - 否则 → 累计 pendingCount 给浮标徽标用。
  // useLayoutEffect 避免用户看到一瞬"还未贴底"的跳动。
  useLayoutEffect(() => {
    const prevMsgCount = lastMsgCountRef.current;
    const msgsGrew = messages.length > prevMsgCount;
    lastMsgCountRef.current = messages.length;

    const streamLen = (streaming?.text?.length ?? 0) + (streaming?.reasoning?.length ?? 0);
    const streamGrew = streamLen > lastStreamingLenRef.current;
    lastStreamingLenRef.current = streamLen;

    if (!msgsGrew && !streamGrew) return;

    if (stickyAtBottom) {
      scrollToBottom(false);
    } else if (msgsGrew) {
      // 只在"新消息"时加徽标 —— streaming tick 太频繁,加徽标会抖。
      const delta = messages.length - prevMsgCount;
      setPendingCount((n) => n + delta);
    }
  }, [messages, streaming?.text, streaming?.reasoning, stickyAtBottom, scrollToBottom]);

  // streaming 从非 null → null(一次对话结束)时,如果仍上滚,增一次计数让用户知道有新完稿。
  const prevStreamingRef = useRef<StreamingAssistantMessage | null>(null);
  useEffect(() => {
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (prev && !streaming && !stickyAtBottom) {
      setPendingCount((n) => n + 1);
    }
  }, [streaming, stickyAtBottom]);

  if (!messages.length && !streaming) {
    return (
      <Wrap ref={wrapRef} role="log" aria-live="polite" aria-label="对话消息">
        <Empty>
          <Pill>Doc Assistant</Pill>
          <div style={{ fontWeight: 600, color: tokens.color.textSecondary }}>
            向当前页面提问吧
          </div>
          <div>可输入 /new 清空上下文;可划词后插入引用</div>
        </Empty>
      </Wrap>
    );
  }

  return (
    <Wrap
      ref={wrapRef}
      role="log"
      aria-live="polite"
      aria-label="对话消息"
      onScroll={onScroll}
    >
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
      {!stickyAtBottom && (
        <ScrollToBottomHost>
          <ScrollToBottomButton
            type="button"
            aria-label={
              pendingCount > 0 ? `${pendingCount} 条新消息,滚动到底部` : '滚动到底部'
            }
            onClick={() => {
              scrollToBottom(true);
              setPendingCount(0);
            }}
          >
            <span aria-hidden>↓</span>
            {pendingCount > 0 ? (
              <>
                新消息 <Badge aria-hidden>+{pendingCount}</Badge>
              </>
            ) : (
              '回到底部'
            )}
          </ScrollToBottomButton>
        </ScrollToBottomHost>
      )}
    </Wrap>
  );
}
