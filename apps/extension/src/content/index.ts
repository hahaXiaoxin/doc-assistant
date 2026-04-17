/**
 * Content Script 入口
 * ---------------------------------------------
 * 职责：
 * - 在宿主页面上幂等创建 Shadow DOM host
 * - 动态加载 sidebar React 应用并挂载
 * - 监听 background 发来的 TOGGLE_SIDEBAR 消息，切换 sidebar 可见性
 *
 * 注意：
 * - 不在 chrome:// / chrome-extension:// 等特殊页面注入（manifest 已通过 matches 限制）
 * - sidebar 通过动态 import 加载，保持 content script 本体轻量
 * - 划词 mini 工具条逻辑在 PHASE2-UI 中接入（commit 8），MVP 本 commit 仅搭壳
 */
import { createLogger, MessageType, type ExtensionMessage } from '@doc-assistant/shared';
import { ensureShadowHost } from './shadow-host';

const logger = createLogger('extension:content');

logger.info('content script 启动', location.href);

let mounted = false;
let visible = false;

async function mountSidebar(): Promise<void> {
  if (mounted) return;
  mounted = true;

  const shadow = ensureShadowHost();
  // 动态 import sidebar 入口，确保 crx 插件能正确处理 chunk
  const { mountSidebarApp } = await import('../sidebar/index');
  mountSidebarApp({
    shadowRoot: shadow.shadowRoot,
    styleContainer: shadow.styleContainer,
    reactContainer: shadow.reactContainer,
    isVisible: () => visible,
    onRequestClose: () => setVisible(false),
  });

  logger.info('sidebar 挂载完成');
}

function setVisible(next: boolean): void {
  visible = next;
  const shadow = document.getElementById('doc-assistant-root');
  if (shadow) {
    shadow.dataset.visible = String(visible);
  }
  // 通知 sidebar 应用
  window.dispatchEvent(
    new CustomEvent('doc-assistant:visibility', { detail: { visible } }),
  );
}

async function toggleSidebar(): Promise<void> {
  await mountSidebar();
  setVisible(!visible);
  logger.debug('sidebar 可见性切换 →', visible);
}

/**
 * 监听来自 background 的消息
 */
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === MessageType.TOGGLE_SIDEBAR) {
    void toggleSidebar().then(() => sendResponse({ type: MessageType.ACK, ok: true }));
    return true; // 保持通道
  }
  if (message.type === MessageType.OPEN_SIDEBAR) {
    void mountSidebar().then(() => {
      setVisible(true);
      sendResponse({ type: MessageType.ACK, ok: true });
    });
    return true;
  }
  return false;
});

// PHASE2: 划词引用 mini 工具条监听（在 commit 8 中接入，详见 docs/ROADMAP.md §1-UI）
