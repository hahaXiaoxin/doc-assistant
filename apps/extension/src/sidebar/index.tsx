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
import type { ChatMessage } from '@doc-assistant/shared';
import {
  runIdentityPipeline,
} from '@doc-assistant/tools';
import {
  identifySessionTopic,
  recallMemory,
  renderRecallMatches,
  shouldIdentify,
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

  // v0.5.0 PR-2：反思 Job 已迁到 offscreen（sidebar 不再监听反思 tick 广播消息）。
  // alarm 触发时 SW 直接转发 REFLECTION_TICK 给 offscreen，offscreen 自己调 runPending。
  // 这里只负责把 PageVisit 结束事件通过 PAGE_VISIT_ENDED 消息转发给 offscreen。
  useEffect(() => {
    if (!bootstrap) return;
    const pvm = bootstrap.pageVisitManager;
    const unsubscribe = pvm.subscribe((event) => {
      if (event.type !== 'end') return;
      const visitId = event.visit.visitId;
      logger.info(`PAGE_VISIT_ENDED → offscreen (visitId=${visitId})`);
      chrome.runtime
        .sendMessage({
          type: MessageType.PAGE_VISIT_ENDED,
          visitId,
          at: Date.now(),
        })
        .catch((err: Error) => {
          // offscreen 未就绪或被 Chrome 暂时回收：下次 alarm tick 会补跑 pending 任务
          logger.debug('PAGE_VISIT_ENDED 发送失败（将由下次 alarm 补跑）', err.message);
        });
    });
    return unsubscribe;
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

    // v0.2.4 · 监听 hashchange（哈希路由 SPA 场景）：
    // - canonicalizeUrl 会剥 hash，visit 不会切（规避反思 Job 等重操作）；
    // - 但 SessionTopic 需要重新识别 —— 清除当前 visit 的 topic，
    //   下一轮用户提问时由 onRoundFinished 的 shouldIdentify 自然触发新话题识别。
    const handleHashChange = () => {
      const current = pvm.getCurrent();
      if (!current) return;
      const now = Date.now();
      void bootstrap.memory
        .setSessionTopic({
          visitId: current.visitId,
          currentTopic: '', // 清空 topic（SessionTopicSource 不再注入）
          tags: [],
          updatedAt: now,
          history: [
            { at: now, topic: '', triggeredBy: 'user_command' as const },
          ],
          ...(current.canonicalUrl !== undefined
            ? { canonicalUrl: current.canonicalUrl }
            : {}),
          ...(current.articleId !== undefined ? { articleId: current.articleId } : {}),
        })
        .catch((err: Error) => {
          logger.warn('hashchange · 清 topic 失败', err.message);
        });
      logger.info('hashchange · 已清当前 topic，等待下轮对话自动重新识别');
    };
    window.addEventListener('hashchange', handleHashChange);

    // tab 关闭前：end 当前 visit（为反思任务登记留出窗口）
    const handleBeforeUnload = () => {
      void pvm.endCurrent();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      history.pushState = originalPush;
      history.replaceState = originalReplace;
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [bootstrap]);

  const pageSummaryMemo = useMemo(
    () => () => buildPageSummary(bootstrap?.pageVisitManager.getCurrent()?.visitId),
    // 依赖 visible 让面板显隐切换时重算（详见 docs/TROUBLESHOOTING.md §5）
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
    // v1.1 PR-2：PageSummary.summary 已删，/topic 无参时没有现成的"最近内容"占位。
    // 这里传空数组即可——identifySessionTopic 内部会按对话历史 + 身份段走常规路径，
    // 失去了这个偷懒兜底也不影响主流程（原来就是"并非理想做法"的权宜实现）。
    const recentMessages: Array<{ role: 'user'; content: string }> = [];
    await identifySessionTopic({
      aux: bootstrap.auxLLM,
      memory: bootstrap.memory,
      visitId: visit.visitId,
      ...(visit.canonicalUrl !== undefined ? { canonicalUrl: visit.canonicalUrl } : {}),
      ...(visit.articleId !== undefined ? { articleId: visit.articleId } : {}),
      recentMessages,
    });
  }, [bootstrap]);

  const onTopicSet = useCallback(
    async (text: string) => {
      if (!bootstrap) return;
      const visit = bootstrap.pageVisitManager.getCurrent();
      if (!visit) return;
      const existing = await bootstrap.memory.getSessionTopic(visit.visitId);
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

  /**
   * v0.2.4 · 每轮对话完成后自动触发 SessionTopic 识别
   * - 之前只有 `/topic` 命令或无人触发；现在每 shouldIdentify(count) = true 就识别
   * - hashchange 清 topic 后，新 visit 下的第 1 轮对话会立即重新识别（shouldIdentify(1) = true）
   * - fire-and-forget 失败降级
   */
  const onRoundFinished = useCallback(
    (info: { userMessageCount: number; recentMessages: ChatMessage[] }) => {
      if (!bootstrap) return;
      // v0.4.0 · 关键词漂移触发：把最后一条 user 消息传给 shouldIdentify，
      // 命中"换个话题/说点别的/switch topic"等显式漂移词则即使未到周期也立即触发。
      const lastUserMsg = [...info.recentMessages]
        .reverse()
        .find((m) => m.role === 'user')?.content;
      if (
        !shouldIdentify(info.userMessageCount, {
          ...(typeof lastUserMsg === 'string' ? { latestUserInput: lastUserMsg } : {}),
        })
      ) {
        return;
      }
      const visit = bootstrap.pageVisitManager.getCurrent();
      if (!visit) return;
      void identifySessionTopic({
        aux: bootstrap.auxLLM,
        memory: bootstrap.memory,
        visitId: visit.visitId,
        ...(visit.canonicalUrl !== undefined ? { canonicalUrl: visit.canonicalUrl } : {}),
        ...(visit.articleId !== undefined ? { articleId: visit.articleId } : {}),
        recentMessages: info.recentMessages,
      }).catch((err: Error) => {
        logger.warn('自动 SessionTopic 识别失败', err.message);
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
        const list = await bootstrap.memory.listPersonas({ status: 'pending' });
        return list.map((p) => ({
          id: p.id,
          subject: p.subject,
          content: p.content,
          confidence: p.confidence,
          createdAt: p.createdAt,
          ...(p.tags && p.tags.length ? { tags: p.tags } : {}),
        }));
      }}
      getWorkingMemory={async () => {
        const visit = bootstrap.pageVisitManager.getCurrent();
        if (!visit?.canonicalUrl) return null;
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
        await bootstrap.memory.updatePersona(
          id,
          { status: 'confirmed', reviewedByUser: true },
          'user confirm via banner',
        );
      }}
      onRejectPersona={async (id) => {
        await bootstrap.memory.updatePersona(
          id,
          { status: 'rejected', reviewedByUser: true },
          'user reject via banner',
        );
      }}
      persistMessage={persistMessage}
      onRoundFinished={onRoundFinished}
      getCurrentVisitMeta={() => {
        const v = bootstrap.pageVisitManager.getCurrent();
        if (!v) return null;
        return {
          visitId: v.visitId,
          ...(v.title ? { title: v.title } : {}),
        };
      }}
    />
  );
}

/**
 * 构造 PageSummary：只跑 Identity pipeline 拿身份段（title + id + canonical + domain）。
 * v0.2：附带 canonicalUrl / domain / visitId（给 Phase2 ContextSource 用）
 * v1.1 PR-2：不再跑 content pipeline 取摘要 —— summary / extractor 字段随
 * PageContextCard 一起删除；主模型要正文时走 `read_page_content`（分页）按需拿。
 * 好处：每次 send 前的 buildInvokeContext 调用不再触发 Readability 全量 DOM 扫描。
 */
function buildPageSummary(visitId?: string): PageSummary | null {
  try {
    const ctx = {
      url: location.href,
      title: document.title,
      document,
    };
    const identity = runIdentityPipeline(ctx);
    const canonicalUrl = canonicalizeUrl(document, location.href);
    return {
      url: ctx.url,
      title: ctx.title,
      identityTitle: identity.title,
      identityId: identity.id,
      canonicalUrl,
      domain: extractDomain(canonicalUrl),
      ...(visitId ? { visitId } : {}),
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
