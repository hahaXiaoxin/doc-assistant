/**
 * Sidebar React 应用入口（由 content script 挂载到 Shadow DOM）
 * ---------------------------------------------
 * 本 commit（#3 extension-shell）只提供一个最小可见的折叠/展开容器，
 * 真正的 ChatPanel（消息流、Lexical 输入框、斜杠命令）在 commit 8 中接入。
 */
import { createRoot, type Root } from 'react-dom/client';
import { StyleSheetManager } from 'styled-components';
import { useEffect, useState } from 'react';
import { createLogger } from '@doc-assistant/shared';
import { SidebarShell } from './SidebarShell';

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
      <SidebarAppBridge {...options} />
    </StyleSheetManager>,
  );
}

/**
 * 订阅宿主 window 的 visibility 事件，把状态传给 SidebarShell
 */
function SidebarAppBridge(props: MountOptions) {
  const [visible, setVisible] = useState(props.isVisible());

  useEffect(() => {
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<{ visible: boolean }>).detail;
      setVisible(detail.visible);
    };
    window.addEventListener('doc-assistant:visibility', handler);
    return () => window.removeEventListener('doc-assistant:visibility', handler);
  }, []);

  return <SidebarShell visible={visible} onClose={props.onRequestClose} />;
}
