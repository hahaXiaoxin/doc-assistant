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
import { ConfirmModal } from '../../components/ConfirmModal';
import {
  IconMessageSquarePlus,
  IconPanelRightClose,
  IconSettings,
} from '../../components/icons';
import {
  PersonaReviewBanner,
  type PersonaView,
} from '../../components/PersonaReviewBanner';
import {
  WorkingMemoryCard,
  type WorkingMemoryView,
} from '../../components/WorkingMemoryCard';
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
  /** v0.2：归一化后的 canonical URL（用于 WorkingMemory / Episodic 索引） */
  canonicalUrl?: string;
  /** v0.2：extractDomain(canonicalUrl) */
  domain?: string;
  /** v0.2：当前活跃 PageVisit ID（用于 SessionTopicSource 等） */
  visitId?: string;
}

/**
 * 把 `PageSummary`（UI 层视图模型）投影为 Agent 调用所需的 `{ page, visitId }` 片段。
 *
 * v1.1 PR-1（Context 瘦身）：
 * - **不再**把 `page.summary` 透传到 AgentInvokeContext.page —— Context 层停止主动
 *   注入页面正文摘要；主模型需要正文时通过 `read_page_content`（分页）按需拿。
 * - 其他身份/元信息（url / title / identityTitle / identityId / canonicalUrl /
 *   domain / visitId）仍然透传，用于 memory 记账 + ContextSource 拼装。
 *
 * 抽成纯函数是为了在 useStreamingChat / ChatPanel 之外也能单测到"page 对象不再含
 * summary"这一契约。
 */
export function buildAgentInvokeContextFragment(
  page: PageSummary | null,
): Omit<AgentInvokeContext, 'history' | 'userInput' | 'references'> {
  if (!page) return {};
  return {
    page: {
      url: page.url,
      title: page.title,
      ...(page.identityTitle ? { identityTitle: page.identityTitle } : {}),
      ...(page.identityId ? { identityId: page.identityId } : {}),
      ...(page.canonicalUrl ? { canonicalUrl: page.canonicalUrl } : {}),
      ...(page.domain ? { domain: page.domain } : {}),
    } as NonNullable<AgentInvokeContext['page']>,
    // visitId 直接放顶层（ContextSource 从 ctx.visitId 读）
    ...(page.visitId ? { visitId: page.visitId } : {}),
  };
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
  /**
   * v1.1 PR-2 头部断层修复：
   * - 删掉 PageContextCard 之后，Header 的 border-bottom + rgba(255,255,255,0.7)
   *   会直接和 MessageList 的纯白背景碰撞，出现一条明显的横线"断层"。
   * - 这里让 Header 背景透明、底边改为极轻的 shadow 分隔（只在有 scroll 内容时
   *   才隐约可见），整个顶部靠外层 CollapsiblePanel 的玻璃 bg 托着，视觉上就
   *   是一整块浅面板向下过渡到消息流。
   */
  background: transparent;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
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
  /**
   * v1.1 PR-3 C2 · 统一 32×32 hit area + 16px icon:
   * - 原来是 28×28 容器 + 16px 字符图标,视觉偏小,移动/触屏下 hit area 不够舒服。
   * - 换成 32×32 更贴近 iOS HIG / Material 推荐的最小 icon button,键盘
   *   focus 环也更好看。
   */
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: ${tokens.radius.sm};
  color: ${tokens.color.textSecondary};
  transition: background ${tokens.motion.fast}, color ${tokens.motion.fast};

  &:hover {
    background: ${tokens.color.bgHoverSubtle};
    color: ${tokens.color.textPrimary};
  }

  &:focus-visible {
    outline: 2px solid ${tokens.color.primary};
    outline-offset: -2px;
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
  min-height: 24px;
`;

/**
 * v1.1 PR-3 C3 · 快捷键提示改为 `?` icon hover tooltip:
 * - 过去是一行长文案常驻,占视觉 + 和主按钮挤同一行不克制。
 * - 现在是 24×24 圆按钮,hover / focus 弹出 popover 气泡,空闲时几乎不可见。
 */
const HintHost = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
`;

const HintButton = styled.button`
  all: unset;
  cursor: help;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${tokens.color.textTertiary};
  border: 1px solid ${tokens.color.border};
  font-size: 11px;
  line-height: 1;
  transition: color ${tokens.motion.fast}, border-color ${tokens.motion.fast};

  &:hover,
  &:focus-visible {
    color: ${tokens.color.textSecondary};
    border-color: ${tokens.color.borderStrong};
    outline: none;
  }
`;

const HintPopover = styled.span`
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  white-space: nowrap;
  padding: 6px 10px;
  background: ${tokens.color.textPrimary};
  color: ${tokens.color.textInverse};
  border-radius: ${tokens.radius.sm};
  font-size: ${tokens.font.sizeSmall};
  line-height: 1.5;
  box-shadow: ${tokens.shadow.card};
  opacity: 0;
  pointer-events: none;
  transition: opacity ${tokens.motion.fast};

  ${HintHost}:hover &,
  ${HintHost}:focus-within & {
    opacity: 1;
  }
`;

/**
 * v1.1 PR-3 C3 · 常驻主按钮:
 * - $mode='send'    · primary 填充 pill,空闲默认态;空输入 disabled
 * - $mode='stop'    · danger 轮廓(不填充)pill,进行中态
 * - $mode='disabled'· 灰色填充 pill · aria-disabled · not-allowed
 */
const PrimaryButton = styled.button<{ $mode: 'send' | 'stop' | 'disabled' }>`
  all: unset;
  box-sizing: border-box;
  cursor: ${(p) => (p.$mode === 'disabled' ? 'not-allowed' : 'pointer')};
  padding: 6px 14px;
  border-radius: ${tokens.radius.pill};
  font-size: ${tokens.font.sizeSmall};
  font-weight: 500;
  line-height: 1.2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background ${tokens.motion.fast}, color ${tokens.motion.fast},
    border-color ${tokens.motion.fast};

  ${(p) =>
    p.$mode === 'send' &&
    `
      background: ${tokens.color.primary};
      color: ${tokens.color.textInverse};
      border: 1px solid ${tokens.color.primary};
      &:hover { background: ${tokens.color.primaryHover}; border-color: ${tokens.color.primaryHover}; }
    `}
  ${(p) =>
    p.$mode === 'stop' &&
    `
      background: transparent;
      color: ${tokens.color.danger};
      border: 1px solid ${tokens.color.danger};
      &:hover { background: rgba(255,77,79,0.08); }
    `}
  ${(p) =>
    p.$mode === 'disabled' &&
    `
      background: ${tokens.color.bgGray};
      color: ${tokens.color.textTertiary};
      border: 1px solid ${tokens.color.border};
    `}

  &:focus-visible {
    outline: 2px solid ${tokens.color.primary};
    outline-offset: 2px;
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
  // v1.1 PR-3 C3 · 由 LexicalChatInput.onContentChange 同步,驱动主按钮 disabled。
  const [inputEmpty, setInputEmpty] = useState(true);

  const slashRegistry = useMemo(() => createDefaultCommandRegistry(), []);

  const chat = useStreamingChat({
    agent,
    buildInvokeContext: (_input, _refs) => buildAgentInvokeContextFragment(getPageSummary()),
    buildToolExecCtx: () => buildToolMeta(),
    getCurrentVisitMeta: getCurrentVisitMeta ?? (() => null),
    ...(persistMessage ? { persistMessage } : {}),
    ...(initialHistoryForLLM ? { initialHistoryForLLM } : {}),
    ...(onRoundFinished ? { onRoundFinished } : {}),
  });

  useSelectionBridge(() => inputActionsRef.current?.insertReference ?? null);

  // v1.1 PR-2：PageContextCard 已删除，这里不再需要为 UI 缓存 pageSummary；
  // send 时 buildInvokeContext 会即时调 getPageSummary() 保证发给 LLM 的信息新鲜。
  // 顺带消掉之前那段"面板显隐切换时重算 pipeline"的兜底逻辑——已无 UI 消费。

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

  /**
   * v1.1 PR-4 C3 · Confirm Modal 状态:
   * - `confirmOpen` 控制 Modal 的可见;
   * - `confirmResolveRef` 存一把 Promise resolve,`requestClearConversation()` 打开
   *   Modal 时 new 一个 Promise,onConfirm/onCancel 时 resolve 对应 true/false。
   *   两个入口(Header 按钮 / slash /new)都走同一把 Modal,避免"同时弹两个"的尴尬。
   * - Modal 的 onConfirm 会**先执行清空动作**再 resolve(true),这样两个入口都不用各自
   *   复制一遍 `chat.clear()` 逻辑;调用方只需要关心"用户是否同意"。
   * - 已经有 Modal 打开时再次触发 → 静默返回 false(避免堆叠多个 Promise)。
   */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmResolveRef = useRef<((ok: boolean) => void) | null>(null);

  const doClearConversation = useCallback(() => {
    chat.clear();
    inputActionsRef.current?.clear();
    inputActionsRef.current?.focus();
  }, [chat]);

  const requestClearConversation = useCallback(() => {
    if (confirmResolveRef.current) {
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirmOpen(true);
    });
  }, []);

  const handleConfirmClear = useCallback(() => {
    doClearConversation();
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmOpen(false);
    resolve?.(true);
  }, [doClearConversation]);

  const handleCancelClear = useCallback(() => {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmOpen(false);
    resolve?.(false);
  }, []);

  /**
   * v1.1 PR-4 C3 · Header "开启新对话"按钮:走同一套 /new 语义 —— 先弹 Confirm Modal,
   * Modal 在 onConfirm 里直接把 UI 清掉并 resolve(true);这里只管收到 true 之后的
   * startNewVisit。失败时 notify。
   */
  const handleClearRequest = useCallback(async () => {
    const ok = await requestClearConversation();
    if (!ok) return;
    if (onStartNewVisit) {
      try {
        await onStartNewVisit();
      } catch (err) {
        messageApi.error(`开启新 visit 失败:${(err as Error).message}`);
        return;
      }
    }
    messageApi.success('已开启新的会话');
  }, [messageApi, onStartNewVisit, requestClearConversation]);

  const slashCtx: SlashCommandContext = {
    clearConversation: () => {
      chat.clear();
      inputActionsRef.current?.clear();
      inputActionsRef.current?.focus();
    },
    requestClearConversation,
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
            <IconButton
              type="button"
              title="开启新对话"
              aria-label="开启新对话"
              onClick={() => {
                void handleClearRequest();
              }}
            >
              <IconMessageSquarePlus />
            </IconButton>
            <IconButton
              type="button"
              title="打开配置"
              aria-label="打开配置"
              onClick={onOpenOptions}
            >
              <IconSettings />
            </IconButton>
            <IconButton
              type="button"
              title="折叠侧栏"
              aria-label="折叠侧栏"
              onClick={onRequestClose}
            >
              <IconPanelRightClose />
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

        <MessageList messages={chat.messages} streaming={chat.streaming} />

        <InputArea id='chat-input-outer'>
          <LexicalChatInput
            disabled={chat.isBusy}
            slashRegistry={slashRegistry}
            slashContext={slashCtx}
            actionsRef={inputActionsRef}
            onContentChange={setInputEmpty}
            onSubmit={handleSubmit}
          />
          <ActionBar>
            <HintHost>
              <HintButton
                type="button"
                aria-label="查看输入快捷键"
                tabIndex={0}
              >
                ?
              </HintButton>
              <HintPopover role="tooltip">
                Enter 发送 · Shift+Enter 换行 · 输入 / 查看命令
              </HintPopover>
            </HintHost>
            {chat.isBusy ? (
              <PrimaryButton
                type="button"
                $mode="stop"
                aria-label="停止生成"
                onClick={chat.abort}
              >
                停止 <span aria-hidden>■</span>
              </PrimaryButton>
            ) : (
              <PrimaryButton
                type="button"
                $mode={inputEmpty ? 'disabled' : 'send'}
                aria-label="发送"
                aria-disabled={inputEmpty}
                onClick={() => {
                  if (inputEmpty) return;
                  inputActionsRef.current?.submit();
                }}
              >
                发送 <span aria-hidden>➤</span>
              </PrimaryButton>
            )}
          </ActionBar>
        </InputArea>
      </CollapsiblePanel>
      <ConfirmModal
        open={confirmOpen}
        title="确定清空当前会话?"
        description="清空后不可恢复。长期记忆(WorkingMemory / Persona / Episodic)不受影响。"
        confirmLabel="清空"
        cancelLabel="取消"
        tone="danger"
        initialFocus="cancel"
        onConfirm={handleConfirmClear}
        onCancel={handleCancelClear}
      />
    </>
  );
}
