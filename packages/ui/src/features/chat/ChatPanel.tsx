/**
 * ChatPanel · 对话主面板
 * ---------------------------------------------
 * 组合：CollapsiblePanel + 标题栏 + 页面上下文卡片 + MessageList + LexicalChatInput
 *
 * 职责：
 * - 装配 Agent 与 UI，通过 useStreamingChat 驱动流式对话
 * - 处理 /new 等 slash 命令
 * - 桥接划词引用（useSelectionBridge）
 *
 * 数据来源（通过 props 注入）：
 * - agent：已由 sidebar bootstrap 构造好的 Agent 实例（注入 Qwen + tools + NullMemoryStore）
 * - buildInvokeContext / buildToolExecCtx：由 sidebar 提供，持有最新 page context
 */
import { useMemo, useRef } from 'react';
import styled from 'styled-components';
import { message } from 'antd';
import type { Agent, AgentInvokeContext } from '@doc-assistant/agent';
import { tokens } from '../../theme/tokens';
import { GlobalStyle } from '../../theme/GlobalStyle';
import { CollapsiblePanel } from '../../components/CollapsiblePanel';
import { LexicalChatInput, type ChatInputActions } from '../../editor/LexicalChatInput';
import { MessageList } from './MessageList';
import { useStreamingChat } from '../../hooks/useStreamingChat';
import { useSelectionBridge } from '../../hooks/useSelectionBridge';
import { createDefaultCommandRegistry } from '../../commands/registry';
import type { SlashCommandContext } from '../../commands/types';

export interface PageSummary {
  url: string;
  title: string;
  identityTitle?: string;
  identityId?: string;
  summary?: string;
}

export interface ChatPanelProps {
  visible: boolean;
  onRequestOpen: () => void;
  onRequestClose: () => void;
  onOpenOptions: () => void;

  agent: Agent;
  /** 每次发送时调用，动态提供当前页面信息 */
  getPageSummary: () => PageSummary | null;
  /** 构造 tool 执行上下文（注入 pageContext 供 read_page_content 等 tool 使用） */
  buildToolMeta: () => Record<string, unknown>;
}

const Header = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  height: 44px;
  border-bottom: 1px solid ${tokens.color.border};
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(8px);
  flex-shrink: 0;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-weight: 600;
  font-size: ${tokens.font.sizeHeading};
`;

const Dot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, ${tokens.color.primary} 0%, ${tokens.color.primaryActive} 100%);
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.12);
  flex-shrink: 0;
`;

const PageTitle = styled.div`
  font-weight: 500;
  font-size: ${tokens.font.sizeSmall};
  color: ${tokens.color.textSecondary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

const IconButton = styled.button`
  all: unset;
  cursor: pointer;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: ${tokens.radius.sm};
  color: ${tokens.color.textSecondary};
  font-size: 16px;
  transition: background ${tokens.motion.fast};

  &:hover {
    background: rgba(0, 0, 0, 0.04);
    color: ${tokens.color.textPrimary};
  }
`;

const ContextCard = styled.div`
  margin: 10px 12px 0;
  padding: 8px 12px;
  background: ${tokens.color.bgSoft};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius.sm};
  font-size: ${tokens.font.sizeSmall};
  color: ${tokens.color.textSecondary};
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const InputArea = styled.div`
  padding: 10px 12px 14px;
  border-top: 1px solid ${tokens.color.border};
  background: ${tokens.color.bgWhite};
  flex-shrink: 0;
`;

const ActionBar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  font-size: ${tokens.font.sizeSmall};
  color: ${tokens.color.textTertiary};
`;

const SendButton = styled.button<{ $disabled?: boolean }>`
  all: unset;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  padding: 6px 14px;
  border-radius: ${tokens.radius.pill};
  background: ${(p) => (p.$disabled ? tokens.color.borderStrong : tokens.color.primary)};
  color: ${tokens.color.textInverse};
  font-size: ${tokens.font.sizeSmall};
  font-weight: 500;
  transition: background ${tokens.motion.fast};
  &:hover {
    background: ${(p) => (p.$disabled ? tokens.color.borderStrong : tokens.color.primaryHover)};
  }
`;

export function ChatPanel({
  visible,
  onRequestOpen,
  onRequestClose,
  onOpenOptions,
  agent,
  getPageSummary,
  buildToolMeta,
}: ChatPanelProps) {
  const [messageApi, contextHolder] = message.useMessage({ top: 52 });
  const inputActionsRef = useRef<ChatInputActions | null>(null);

  const slashRegistry = useMemo(() => createDefaultCommandRegistry(), []);

  const chat = useStreamingChat({
    agent,
    buildInvokeContext: (_input, _refs) => {
      const page = getPageSummary();
      return page
        ? {
            page: {
              url: page.url,
              title: page.title,
              ...(page.summary ? { summary: page.summary } : {}),
              ...(page.identityTitle ? { identityTitle: page.identityTitle } : {}),
              ...(page.identityId ? { identityId: page.identityId } : {}),
            } as NonNullable<AgentInvokeContext['page']>,
          }
        : {};
    },
    buildToolExecCtx: () => buildToolMeta(),
  });

  useSelectionBridge(() => inputActionsRef.current?.insertReference ?? null);

  // 只在 ChatPanel 首次挂载或 visible 切换时抓一次页面摘要，
  // 避免每次输入都因 forceTick 重渲染触发 runIdentityPipeline + runContentPipeline
  // （那两个会遍历/克隆全量 DOM，在大页面上会造成秒级输入延迟）
  const pageSummary = useMemo(
    () => getPageSummary(),
    // 仅在面板显示切换时重算，send 时也会主动通过 buildInvokeContext 现取
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible],
  );

  const slashCtx: SlashCommandContext = {
    clearConversation: () => {
      chat.clear();
      inputActionsRef.current?.clear();
      inputActionsRef.current?.focus();
    },
    closeMenu: () => {},
    notify: (msg) => messageApi.success(msg),
  };

  const handleSubmit = (payload: {
    userInput: string;
    references: import('../../editor/nodes/ReferenceNode').ReferencePayload[];
  }) => {
    const refsText = payload.references
      .map((r) => `- ${r.text}（来源：${r.source.url}）`)
      .join('\n');
    void chat.send(payload.userInput, refsText || undefined);
    inputActionsRef.current?.clear();
  };

  return (
    <>
      <GlobalStyle />
      {contextHolder}
      <CollapsiblePanel visible={visible} onRequestOpen={onRequestOpen}>
        <Header>
          <HeaderLeft>
            <Dot />
            <span>Doc Assistant</span>
          </HeaderLeft>
          <div style={{ display: 'flex', gap: 4 }}>
            <IconButton title="清空上下文（/new）" onClick={slashCtx.clearConversation}>
              ⟳
            </IconButton>
            <IconButton title="打开配置" onClick={onOpenOptions}>
              ⚙
            </IconButton>
            <IconButton title="折叠" onClick={onRequestClose}>
              ✕
            </IconButton>
          </div>
        </Header>

        {pageSummary && (
          <ContextCard>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              📄 {pageSummary.identityTitle ?? pageSummary.title}
            </span>
            <span style={{ color: tokens.color.textTertiary }}>
              {pageSummary.summary ? `${pageSummary.summary.length}字摘要` : '无摘要'}
            </span>
          </ContextCard>
        )}

        {!pageSummary && (
          <ContextCard>
            <span style={{ flex: 1 }}>尚未识别到当前页面信息</span>
          </ContextCard>
        )}

        <MessageList messages={chat.messages} streaming={chat.streaming} />

        <InputArea>
          <LexicalChatInput
            disabled={chat.isBusy}
            slashRegistry={slashRegistry}
            slashContext={slashCtx}
            actionsRef={inputActionsRef}
            onSubmit={handleSubmit}
          />
          <ActionBar>
            <span>Enter 发送 · Shift+Enter 换行 · 输入 / 查看命令</span>
            {chat.isBusy ? (
              <SendButton onClick={chat.abort}>停止</SendButton>
            ) : (
              <PageTitle>{pageSummary?.url ?? ''}</PageTitle>
            )}
          </ActionBar>
        </InputArea>
      </CollapsiblePanel>
    </>
  );
}
