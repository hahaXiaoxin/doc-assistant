/**
 * Sidebar React 应用入口（由 content script 挂载到 Shadow DOM）
 * ---------------------------------------------
 * 装配：
 * - 从 chrome.storage 读取 Qwen 配置 → 构造 ChatAgent
 * - 运行页面提取 pipeline 获取当前文章身份与摘要 → 作为 PageSummary 注入 ChatPanel
 * - ChatPanel 通过 Agent 发起对话，tool 执行时能访问当前页面 document
 */
import { createRoot, type Root } from 'react-dom/client';
import { StyleSheetManager } from 'styled-components';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useEffect, useMemo, useState } from 'react';
import { createLogger, MessageType } from '@doc-assistant/shared';
import {
  runIdentityPipeline,
  runContentPipeline,
  contentRegistry,
  type ContentExtractor,
} from '@doc-assistant/tools';
import { ChatPanel, type PageSummary } from '@doc-assistant/ui';
import { bootstrapAgent } from './bootstrap';

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
    void bootstrapAgent().then(setBootstrap).catch((err) => {
      logger.error('bootstrap 失败:', (err as Error).message);
    });
  }, []);

  const pageSummaryMemo = useMemo(
    () => () => buildPageSummary(),
    [],
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
 */
function buildPageSummary(): PageSummary | null {
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
    return {
      url: ctx.url,
      title: ctx.title,
      identityTitle: identity.title,
      identityId: identity.id,
      ...(extracted ? { summary: extracted.excerpt } : {}),
    };
  } catch (err) {
    logger.warn('buildPageSummary 失败:', (err as Error).message);
    return null;
  }
}

function getNonSelectionExtractors(): ContentExtractor[] {
  return contentRegistry.list().filter((e) => e.name !== 'selection');
}
