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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { message } from 'antd';
import type { Agent, AgentInvokeContext } from '@doc-assistant/agent';
import type { ChatMessage } from '@doc-assistant/shared';
import { tokens } from '../../theme/tokens';
import { GlobalStyle } from '../../theme/GlobalStyle';
import { CollapsiblePanel } from '../../components/CollapsiblePanel';
import {
  PersonaReviewBanner,
  type PersonaView,
} from '../../components/PersonaReviewBanner';
import {
  WorkingMemoryCard,
  type WorkingMemoryView,
} from '../../components/WorkingMemoryCard';
import { PageContextCard } from '../../components/PageContextCard';
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
  /** v0.2：归一化后的 canonical URL（用于 WorkingMemory / Episodic 索引） */
  canonicalUrl?: string;
  /** v0.2：extractDomain(canonicalUrl) */
  domain?: string;
  /** v0.2：当前活跃 PageVisit ID（用于 SessionTopicSource 等） */
  visitId?: string;
  /**
   * v0.2.4：摘要来源的提取器标签（readability / semantic / full-body / selection）。
   * full-body 可信度低（可能含导航/菜单噪声），UI 需要降级提示。
   */
  extractor?: string;
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

  /* -------- v0.2.1 slash 命令相关回调（全部可选） -------- */

  /**
   * /new 命令：开启新 PageVisit。通常实现为 `pageVisitManager.endCurrent()` 后
   * 立即 `startNewVisit({...current})`；不清 WorkingMemory/Persona/Episodic。
   */
  onStartNewVisit?: () => Promise<void> | void;
  /**
   * /recall <query> 命令：执行召回并返回一段格式化文本（通常由 `recallMemory` +
   * `renderRecallMatches` 产出）。返回 null 表示未命中。
   */
  onRecall?: (query: string) => Promise<{ text: string; hit: boolean } | null>;
  /**
   * /topic（无参）：强制触发一次辅助 LLM 主题识别。
   */
  onTopicIdentify?: () => Promise<void>;
  /**
   * /topic <text>（有参）：手动设置当前 visit 的 SessionTopic。
   */
  onTopicSet?: (text: string) => Promise<void>;

  /* -------- v0.2.1 Persona 审核 / WorkingMemory 卡片相关 -------- */

  /** 获取当前 pending 的 Persona 候选（由反思 Job 产出）。返回空数组组件自动隐藏。 */
  getPendingPersonas?: () => Promise<PersonaView[]>;
  /** 获取当前 canonicalUrl 对应的 WorkingMemory。返回 null 组件自动隐藏。 */
  getWorkingMemory?: () => Promise<WorkingMemoryView | null>;
  /** Persona 审核动作：confirm（接受 → status:'confirmed', reviewedByUser:true） */
  onConfirmPersona?: (id: string) => Promise<void>;
  /** Persona 审核动作：reject（拒绝 → status:'rejected'） */
  onRejectPersona?: (id: string) => Promise<void>;

  /* -------- v0.2.3 消息持久化 + 刷新预热 -------- */

  /**
   * v0.2.3：每条 user/assistant 消息成功产生时调用一次，
   * 由 sidebar 负责写入 episodes_msg（含 visitId/canonicalUrl/orderInVisit）。
   * 缺省时聊天仍可用，只是不落库（无持久化能力时的降级表现）。
   */
  persistMessage?: (msg: { role: 'user' | 'assistant'; content: string }) => Promise<void>;
  /**
   * v0.2.3：从 IDB 预热的"上次对话"消息。**不进 UI**，仅在 send() 组装 history 时前置。
   * 由 sidebar 在 mount 后按"WorkingMemory → 跨 visit 近 5 轮 → 向量召回"三段式策略生成。
   */
  initialHistoryForLLM?: ChatMessage[];
  /**
   * v0.2.4：每轮对话完成后的副作用回调（主要用于自动触发 SessionTopic 识别）。
   * useStreamingChat 会带入 userMessageCount + 最近 6 条消息，由 sidebar 决定是否识别。
   */
  onRoundFinished?: (info: {
    userMessageCount: number;
    recentMessages: ChatMessage[];
  }) => void;
  /**
   * v0.2.4：获取当前 PageVisit 元信息（visitId + title）。
   * 用于给每条 UIMessage 打溯源标签 + 组装 history 时按 visit 分组降级。
   */
  getCurrentVisitMeta?: () => { visitId: string; title?: string } | null;
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
  onStartNewVisit,
  onRecall,
  onTopicIdentify,
  onTopicSet,
  getPendingPersonas,
  getWorkingMemory,
  onConfirmPersona,
  onRejectPersona,
  persistMessage,
  initialHistoryForLLM,
  onRoundFinished,
  getCurrentVisitMeta,
}: ChatPanelProps) {
  const [messageApi, contextHolder] = message.useMessage({ top: 52 });
  const inputActionsRef = useRef<ChatInputActions | null>(null);

  const slashRegistry = useMemo(() => createDefaultCommandRegistry(), []);

  const chat = useStreamingChat({
    agent,
    buildInvokeContext: (_input, _refs) => {
      const page = getPageSummary();
      if (!page) return {};
      return {
        page: {
          url: page.url,
          title: page.title,
          ...(page.summary ? { summary: page.summary } : {}),
          ...(page.identityTitle ? { identityTitle: page.identityTitle } : {}),
          ...(page.identityId ? { identityId: page.identityId } : {}),
          ...(page.canonicalUrl ? { canonicalUrl: page.canonicalUrl } : {}),
          ...(page.domain ? { domain: page.domain } : {}),
        } as NonNullable<AgentInvokeContext['page']>,
        // visitId 直接放顶层（ContextSource 从 ctx.visitId 读）
        ...(page.visitId ? { visitId: page.visitId } : {}),
      };
    },
    buildToolExecCtx: () => buildToolMeta(),
    getCurrentVisitMeta: getCurrentVisitMeta ?? (() => null),
    ...(persistMessage ? { persistMessage } : {}),
    ...(initialHistoryForLLM ? { initialHistoryForLLM } : {}),
    ...(onRoundFinished ? { onRoundFinished } : {}),
  });

  useSelectionBridge(() => inputActionsRef.current?.insertReference ?? null);

  // pageSummary 只在面板显隐切换时重算 · 详见 docs/TROUBLESHOOTING.md §5
  // 不缓存会让每次输入都同步跑 runIdentityPipeline + runContentPipeline（全量
  // DOM 克隆 + Readability），造成秒级输入延迟并诱发宿主页面 IO 误触发。
  // send 时 buildInvokeContext 会即时调 getPageSummary() 保证发给 LLM 的信息新鲜。
  const pageSummary = useMemo(
    () => getPageSummary(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible],
  );

  // v0.2.1：WorkingMemory / Persona 数据刷新
  // 策略：
  // - mount 时刷一次；
  // - 每 5s 轮询 WorkingMemory（assistant 可能调 tool 改动过）；
  // - 每次 chat.streaming 从非 null 回到 null（对话结束）时触发一次 Persona 刷新（delayed 3s，
  //   因为反思 Job 是异步的，立即查大概率还没入库）；
  // - refreshKey 递增让子组件内部的 useEffect 重跑 getter。
  const [wmRefreshKey, setWmRefreshKey] = useState(0);
  const [personaRefreshKey, setPersonaRefreshKey] = useState(0);
  const [workingMemory, setWorkingMemory] = useState<WorkingMemoryView | null>(null);
  const prevStreamingRef = useRef(chat.streaming);

  // WorkingMemory：5s 轮询 + 依 wmRefreshKey 变化触发
  useEffect(() => {
    if (!getWorkingMemory) return;
    let cancelled = false;
    const reload = async () => {
      try {
        const wm = await getWorkingMemory();
        if (!cancelled) setWorkingMemory(wm);
      } catch {
        if (!cancelled) setWorkingMemory(null);
      }
    };
    void reload();
    const id = window.setInterval(reload, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [getWorkingMemory, wmRefreshKey]);

  // 对话结束信号 → 刷新 WorkingMemory 立即；Persona 延迟 3s
  useEffect(() => {
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = chat.streaming;
    if (prev !== null && chat.streaming === null) {
      setWmRefreshKey((k) => k + 1);
      const t = window.setTimeout(() => {
        setPersonaRefreshKey((k) => k + 1);
      }, 3_000);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [chat.streaming]);

  const memoizedGetPendingPersonas = useCallback(async () => {
    if (!getPendingPersonas) return [];
    try {
      return await getPendingPersonas();
    } catch {
      return [];
    }
  }, [getPendingPersonas]);

  const slashCtx: SlashCommandContext = {
    clearConversation: () => {
      chat.clear();
      inputActionsRef.current?.clear();
      inputActionsRef.current?.focus();
    },
    closeMenu: () => {},
    notify: (msg) => messageApi.success(msg),
    appendAssistantNote: (content) => chat.appendAssistantNote(content),
    startNewVisit: onStartNewVisit ?? (async () => {}),
    triggerRecall: async (query: string) => {
      if (!onRecall) {
        messageApi.info('未在历史记忆中找到相关内容');
        return;
      }
      const out = await onRecall(query);
      if (!out || !out.hit) {
        messageApi.info('未在历史记忆中找到相关内容');
        return;
      }
      chat.appendAssistantNote(out.text);
    },
    triggerTopicIdentify: onTopicIdentify ?? (async () => {}),
    setSessionTopic: onTopicSet ?? (async () => {}),
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

        {/* v0.2.1：Persona 审核条 + WorkingMemory 卡片 */}
        {getPendingPersonas && onConfirmPersona && onRejectPersona && (
          <PersonaReviewBanner
            getPending={memoizedGetPendingPersonas}
            onConfirm={onConfirmPersona}
            onReject={onRejectPersona}
            onOpenOptions={onOpenOptions}
            refreshKey={personaRefreshKey}
          />
        )}
        <WorkingMemoryCard wm={workingMemory} />

        <PageContextCard
          page={
            pageSummary
              ? {
                  title: pageSummary.identityTitle ?? pageSummary.title,
                  url: pageSummary.url,
                  ...(pageSummary.summary !== undefined
                    ? { summary: pageSummary.summary }
                    : {}),
                  ...(pageSummary.extractor !== undefined
                    ? { extractor: pageSummary.extractor }
                    : {}),
                }
              : null
          }
        />

        <MessageList messages={chat.messages} streaming={chat.streaming} />

        <InputArea id='chat-input-outer'>
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
            ) : null}
          </ActionBar>
        </InputArea>
      </CollapsiblePanel>
    </>
  );
}
