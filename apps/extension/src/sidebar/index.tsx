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
import { useEffect, useMemo, useRef, useState } from 'react';
import { canonicalizeUrl, createLogger, extractDomain, MessageType } from '@doc-assistant/shared';
import {
  runIdentityPipeline,
  runContentPipeline,
  contentRegistry,
  type ContentExtractor,
} from '@doc-assistant/tools';
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
