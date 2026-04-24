/**
 * Sidebar React 应用入口（由 content script 挂载到 Shadow DOM）
 * ---------------------------------------------
 * 装配：
 * - 从 chrome.storage 读取三套 Provider 配置 → 构造 ChatAgent（phase2 模式）
 * - 运行页面提取 pipeline 获取当前文章身份与摘要 → 作为 PageSummary 注入 ChatPanel
 * - ChatPanel 通过 Agent 发起对话，tool 执行时能访问当前页面 document
 *
 * v0.2 新增：
 * - PageVisitManager 管理 visit 生命周期（挂载时 startNewVisit；location 变化时 onUrlChange；卸载时 endCurrent）
 * - 构造 AgentInvokeContext 时注入 visitId 与 canonicalUrl（给 Persona/SessionTopic/WorkingMemorySource 用）
 */
import { createRoot, type Root } from 'react-dom/client';
import { StyleSheetManager } from 'styled-components';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canonicalizeUrl, createLogger, extractDomain, MessageType } from '@doc-assistant/shared';
import {
  runIdentityPipeline,
  runContentPipeline,
  contentRegistry,
  type ContentExtractor,
} from '@doc-assistant/tools';
import {
  identifySessionTopic,
  recallMemory,
  renderRecallMatches,
} from '@doc-assistant/agent';
import { ChatPanel, type PageSummary } from '@doc-assistant/ui';
import { bootstrapAgent } from './bootstrap';
import { installShadowSelectionPatch } from './patch-shadow-selection';

const logger = createLogger('extension:sidebar');

export interface MountOptions {
  shadowRoot: ShadowRoot;
  styleContainer: HTMLElement;
  reactContainer: HTMLElement;
  isVisible: () => boolean;
  onRequestClose: () => void;
}

let root: Root | null = null;

export function mountSidebarApp(options: MountOptions): void {
  if (root) {
    logger.debug('sidebar 已挂载，跳过');
    return;
  }
  // 关键：在 React 挂载前打 patch，确保 Lexical 首次渲染就能拿到 shadow 内选区
  installShadowSelectionPatch(options.shadowRoot);
  root = createRoot(options.reactContainer);
  root.render(
    <StyleSheetManager target={options.styleContainer}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          token: {
            colorPrimary: '#1677FF',
            borderRadius: 8,
            fontFamily: 'PingFang SC, -apple-system, Segoe UI, Roboto, sans-serif',
          },
        }}
        getPopupContainer={() => options.shadowRoot as unknown as HTMLElement}
      >
        <SidebarApp {...options} />
      </ConfigProvider>
    </StyleSheetManager>,
  );
}

function SidebarApp(props: MountOptions) {
  const [visible, setVisible] = useState(props.isVisible());
  const [bootstrap, setBootstrap] = useState<Awaited<ReturnType<typeof bootstrapAgent>> | null>(
    null,
  );

  useEffect(() => {
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<{ visible: boolean }>).detail;
      setVisible(detail.visible);
    };
    window.addEventListener('doc-assistant:visibility', handler);
    return () => window.removeEventListener('doc-assistant:visibility', handler);
  }, []);

  useEffect(() => {
    void bootstrapAgent()
      .then(setBootstrap)
      .catch((err) => {
        logger.error('bootstrap 失败:', (err as Error).message);
      });
  }, []);

  // v0.2.1：监听 SW 的 REFLECTION_SCAN_TICK（chrome.alarms 每 60 分钟触发一次）
  useEffect(() => {
    if (!bootstrap?.reflectionScheduler) return;
    const scheduler = bootstrap.reflectionScheduler;
    const handler = (message: { type?: string } | undefined) => {
      if (message?.type !== MessageType.REFLECTION_SCAN_TICK) return;
      logger.info('收到 REFLECTION_SCAN_TICK，触发 runPending');
      void scheduler.runPending().catch((err: Error) => {
        logger.warn('runPending 失败', err.message);
      });
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => {
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, [bootstrap]);

  // v0.2：PageVisit 生命周期管理
  const visitStartedRef = useRef(false);
  useEffect(() => {
    if (!bootstrap) return;
    const pvm = bootstrap.pageVisitManager;

    // 首次挂载：开启第一个 visit
    if (!visitStartedRef.current) {
      visitStartedRef.current = true;
      const identity = safeRunIdentity();
      void pvm.startNewVisit({
        url: location.href,
        doc: document,
        ...(identity?.id ? { articleId: identity.id } : {}),
        ...(identity?.title ? { title: identity.title } : {}),
      });
    }

    // 监听 SPA 路由变化：pushState / replaceState / popstate
    const handleUrlChange = () => {
      const identity = safeRunIdentity();
      void pvm.onUrlChange({
        url: location.href,
        doc: document,
        ...(identity?.id ? { articleId: identity.id } : {}),
        ...(identity?.title ? { title: identity.title } : {}),
      });
    };
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    history.pushState = function (...args) {
      originalPush.apply(this, args as Parameters<typeof originalPush>);
      handleUrlChange();
    };
    history.replaceState = function (...args) {
      originalReplace.apply(this, args as Parameters<typeof originalReplace>);
      handleUrlChange();
    };
    window.addEventListener('popstate', handleUrlChange);

    // tab 关闭前：end 当前 visit（为反思任务登记留出窗口）
    const handleBeforeUnload = () => {
      void pvm.endCurrent();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      history.pushState = originalPush;
      history.replaceState = originalReplace;
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [bootstrap]);

  const pageSummaryMemo = useMemo(
    () => () => buildPageSummary(bootstrap?.pageVisitManager.getCurrent()?.visitId),
    // 依赖 visible 让面板显隐切换时重算（延续 v0.1.1 §5 修复）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, bootstrap],
  );

  /* ----------- v0.2.3 消息持久化 + 刷新预热 ----------- */

  /**
   * orderInVisit 单调递增计数器：用于 episodes_msg 的 (visitId, orderInVisit) 排序。
   * visit 切换时不重置（每个 visit 的 orderInVisit 通过当前 visitId 区分），
   * 但我们用一个 ref 累计本次 sidebar 生命周期里的顺序即可——刷新/重载后新的 sidebar
   * 从 0 重启是可以接受的（orderInVisit 只是 visit 内的相对序，不是全局唯一）。
   */
  const orderInVisitRef = useRef(0);
  const lastVisitIdRef = useRef<string | null>(null);

  /**
   * 持久化一条消息到 episodes_msg。
   * - 失败（例如 NullStore / DexieMemoryStore 尚未 ready）会 throw，useStreamingChat 捕获并打 warn 不阻塞。
   * - visit 未建立时跳过写入（不算错误）。
   */
  const persistMessage = useCallback(
    async (msg: { role: 'user' | 'assistant'; content: string }): Promise<void> => {
      if (!bootstrap) return;
      const visit = bootstrap.pageVisitManager.getCurrent();
      if (!visit) return; // 还没建立 visit 不落库

      // 切换 visit 时重置 orderInVisit（新 visit 从 0 开始）
      if (lastVisitIdRef.current !== visit.visitId) {
        orderInVisitRef.current = 0;
        lastVisitIdRef.current = visit.visitId;
      }

      const now = Date.now();
      const id = `msg_${now}_${Math.random().toString(36).slice(2, 8)}`;
      await bootstrap.memory.remember({
        id,
        type: 'message',
        role: msg.role,
        content: msg.content,
        timestamp: now,
        visitId: visit.visitId,
        orderInVisit: orderInVisitRef.current++,
        ...(visit.canonicalUrl !== undefined ? { canonicalUrl: visit.canonicalUrl } : {}),
        ...(visit.domain !== undefined ? { domain: visit.domain } : {}),
        ...(visit.articleId !== undefined ? { articleId: visit.articleId } : {}),
      });
    },
    [bootstrap],
  );

  /**
   * v0.2.3：刷新预热 history 供 LLM。
   * 三段式 fallback（见 docs/ROADMAP.md v0.2.3）：
   *   1. WorkingMemoryArchive：已由 WorkingMemorySource 自动注入 system prompt，本处不重复
   *   2. 近期消息档：按 canonicalUrl 跨 visit 拉最近 5 轮（10 条）消息
   *   3. 向量召回档：不在此处触发；由用户提问时 RelevantMemorySource 自动召回
   *
   * 注：**不会展示在 UI** —— 只用于组装给 LLM 的 history。
   * 由 ChatPanel.initialHistoryForLLM 消费。
   */
  const [initialHistoryForLLM, setInitialHistoryForLLM] = useState<
    Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>
  >([]);
  const rehydratedRef = useRef(false);
  useEffect(() => {
    if (!bootstrap || rehydratedRef.current) return;
    const visit = bootstrap.pageVisitManager.getCurrent();
    if (!visit?.canonicalUrl) return; // 还没建立 visit，下次 effect 再试
    rehydratedRef.current = true;

    void (async () => {
      try {
        // 第 2 档：跨 visit 拉当前 canonicalUrl 的最近消息
        const recalled = await bootstrap.memory.recall({
          types: ['message'],
          canonicalUrl: visit.canonicalUrl!,
          limit: 50, // 拉 50 条作为候选池，后续裁剪为 10 条
        });
        if (recalled.length === 0) return;

        // 按 timestamp 升序（老 → 新）
        const sorted = [...recalled].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
        // 取最近 10 条（5 轮），超过 3000 字从最早开始裁
        const MAX_MESSAGES = 10;
        const MAX_CHARS = 3000;
        const recent = sorted.slice(-MAX_MESSAGES);
        // 字数裁剪
        let totalChars = recent.reduce((s, r) => s + (r.content?.length ?? 0), 0);
        let start = 0;
        while (totalChars > MAX_CHARS && start < recent.length - 1) {
          totalChars -= recent[start]!.content?.length ?? 0;
          start++;
        }
        const final = recent.slice(start).map((r) => ({
          role: (r.role === 'user' || r.role === 'assistant' ? r.role : 'user') as
            | 'user'
            | 'assistant',
          content: r.content ?? '',
        }));
        if (final.length > 0) {
          logger.info('rehydrate: 预热 history', {
            count: final.length,
            totalChars: final.reduce((s, m) => s + m.content.length, 0),
            firstRole: final[0]!.role,
          });
          setInitialHistoryForLLM(final);
        }
      } catch (err) {
        logger.warn('rehydrate 失败', (err as Error).message);
      }
    })();
  }, [bootstrap]);

  /* ----------- v0.2.1 slash 命令回调 ----------- */

  const onStartNewVisit = useCallback(async () => {
    if (!bootstrap) return;
    const pvm = bootstrap.pageVisitManager;
    const identity = safeRunIdentity();
    // 先 end 当前（触发反思 Job 登记），再开新 visit
    await pvm.endCurrent();
    await pvm.startNewVisit({
      url: location.href,
      doc: document,
      ...(identity?.id ? { articleId: identity.id } : {}),
      ...(identity?.title ? { title: identity.title } : {}),
    });
  }, [bootstrap]);

  const onRecall = useCallback(
    async (query: string): Promise<{ text: string; hit: boolean } | null> => {
      if (!bootstrap) return null;
      const outcome = await recallMemory(
        { memory: bootstrap.memory, aux: bootstrap.auxLLM },
        { query, mode: 'explicit' },
      );
      if (!outcome.hit) return { text: '', hit: false };
      return { text: renderRecallMatches(outcome.matches), hit: true };
    },
    [bootstrap],
  );

  const onTopicIdentify = useCallback(async () => {
    if (!bootstrap) return;
    const visit = bootstrap.pageVisitManager.getCurrent();
    if (!visit) {
      logger.warn('/topic 识别失败：当前无活跃 PageVisit');
      return;
    }
    // 从 UI 取最近消息（通过 ChatPanel 的 pageSummary 并非理想做法；这里偷懒用
    // page summary 的 summary 作为"最近内容"占位，实际效果由辅 LLM 评估）
    const sum = pageSummaryMemo();
    const recentMessages = sum?.summary
      ? [{ role: 'user' as const, content: sum.summary }]
      : [];
    await identifySessionTopic({
      aux: bootstrap.auxLLM,
      memory: bootstrap.memory,
      visitId: visit.visitId,
      ...(visit.canonicalUrl !== undefined ? { canonicalUrl: visit.canonicalUrl } : {}),
      ...(visit.articleId !== undefined ? { articleId: visit.articleId } : {}),
      recentMessages,
    });
  }, [bootstrap, pageSummaryMemo]);

  const onTopicSet = useCallback(
    async (text: string) => {
      if (!bootstrap) return;
      const visit = bootstrap.pageVisitManager.getCurrent();
      if (!visit || !bootstrap.memory.setSessionTopic) return;
      const existing = bootstrap.memory.getSessionTopic
        ? await bootstrap.memory.getSessionTopic(visit.visitId)
        : null;
      await bootstrap.memory.setSessionTopic({
        visitId: visit.visitId,
        currentTopic: text,
        tags: existing?.tags ?? [],
        updatedAt: Date.now(),
        history: [
          ...(existing?.history ?? []),
          { at: Date.now(), topic: text, triggeredBy: 'user_command' as const },
        ].slice(-20),
        ...(existing?.canonicalUrl !== undefined
          ? { canonicalUrl: existing.canonicalUrl }
          : visit.canonicalUrl !== undefined
            ? { canonicalUrl: visit.canonicalUrl }
            : {}),
        ...(existing?.articleId !== undefined
          ? { articleId: existing.articleId }
          : visit.articleId !== undefined
            ? { articleId: visit.articleId }
            : {}),
      });
    },
    [bootstrap],
  );

  if (!bootstrap) {
    return null; // 静默等待 bootstrap
  }

  return (
    <ChatPanel
      visible={visible}
      onRequestOpen={() => {
        setVisible(true);
        document.getElementById('doc-assistant-root')!.dataset.visible = 'true';
      }}
      onRequestClose={() => {
        props.onRequestClose();
      }}
      onOpenOptions={() => {
        void chrome.runtime.sendMessage({ type: MessageType.OPEN_OPTIONS });
      }}
      agent={bootstrap.agent}
      getPageSummary={pageSummaryMemo}
      buildToolMeta={() => ({
        pageContext: {
          url: location.href,
          title: document.title,
          document,
          selectionText: window.getSelection()?.toString() ?? '',
        },
      })}
      onStartNewVisit={onStartNewVisit}
      onRecall={onRecall}
      onTopicIdentify={onTopicIdentify}
      onTopicSet={onTopicSet}
      getPendingPersonas={async () => {
        if (!bootstrap.memory.listPersonas) return [];
        const list = await bootstrap.memory.listPersonas({ status: 'pending' });
        return list.map((p) => ({
          id: p.id,
          content: p.content,
          confidence: p.confidence,
          createdAt: p.createdAt,
          ...(p.tags && p.tags.length ? { tags: p.tags } : {}),
        }));
      }}
      getWorkingMemory={async () => {
        const visit = bootstrap.pageVisitManager.getCurrent();
        if (!visit?.canonicalUrl || !bootstrap.memory.getWorkingMemory) return null;
        const wm = await bootstrap.memory.getWorkingMemory(visit.canonicalUrl);
        if (!wm) return null;
        return {
          canonicalUrl: wm.canonicalUrl,
          ...(wm.activeGoal !== undefined ? { activeGoal: wm.activeGoal } : {}),
          todos: wm.todos.map((t) => ({
            id: t.id,
            content: t.content,
            status: t.status,
            ...(t.priority !== undefined ? { priority: t.priority } : {}),
            ...(t.notes !== undefined ? { notes: t.notes } : {}),
          })),
        };
      }}
      onConfirmPersona={async (id) => {
        await bootstrap.memory.updatePersona?.(
          id,
          { status: 'confirmed', reviewedByUser: true },
          'user confirm via banner',
        );
      }}
      onRejectPersona={async (id) => {
        await bootstrap.memory.updatePersona?.(
          id,
          { status: 'rejected', reviewedByUser: true },
          'user reject via banner',
        );
      }}
      persistMessage={persistMessage}
      initialHistoryForLLM={initialHistoryForLLM}
    />
  );
}

/**
 * 构造 PageSummary：跑 Identity + Content pipeline，取前 800 字作为摘要。
 * v0.2：附带 canonicalUrl / domain / visitId（给 Phase2 ContextSource 用）
 */
function buildPageSummary(visitId?: string): PageSummary | null {
  try {
    const ctx = {
      url: location.href,
      title: document.title,
      document,
      ...(window.getSelection()?.toString()
        ? { selectionText: window.getSelection()!.toString() }
        : {}),
    };
    const identity = runIdentityPipeline(ctx);
    // 摘要用非 selection 的 extractors（避免用户划词时页面上下文被替换为选区）
    const extracted = runContentPipeline(ctx, getNonSelectionExtractors());
    const canonicalUrl = canonicalizeUrl(document, location.href);
    return {
      url: ctx.url,
      title: ctx.title,
      identityTitle: identity.title,
      identityId: identity.id,
      canonicalUrl,
      domain: extractDomain(canonicalUrl),
      ...(visitId ? { visitId } : {}),
      ...(extracted ? { summary: extracted.excerpt } : {}),
      ...(extracted?.extractor ? { extractor: extracted.extractor } : {}),
    };
  } catch (err) {
    logger.warn('buildPageSummary 失败:', (err as Error).message);
    return null;
  }
}

function safeRunIdentity(): ReturnType<typeof runIdentityPipeline> | null {
  try {
    return runIdentityPipeline({
      url: location.href,
      title: document.title,
      document,
    });
  } catch (err) {
    logger.warn('runIdentityPipeline 失败', (err as Error).message);
    return null;
  }
}

function getNonSelectionExtractors(): ContentExtractor[] {
  return contentRegistry.list().filter((e) => e.name !== 'selection');
}
