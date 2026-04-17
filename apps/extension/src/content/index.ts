/**
 * Content Script 入口
 * ---------------------------------------------
 * 职责：
 * - 在宿主页面上幂等创建 Shadow DOM host
 * - 动态加载 sidebar React 应用并挂载
 * - 监听 background 发来的 TOGGLE_SIDEBAR / OPEN_SIDEBAR 消息
 * - 初始化划词迷你工具条（selectionchange → 弹 chip → 点击触发 sidebar 打开 + 插入引用）
 *
 * 注意：
 * - 不在 chrome:// / chrome-extension:// 等特殊页面注入（manifest matches 已限制）
 */
import { createLogger, MessageType, type ExtensionMessage } from '@doc-assistant/shared';
import { ensureShadowHost } from './shadow-host';
import { initSelectionToolbar } from './selection-toolbar';

const logger = createLogger('extension:content');

logger.info('content script 启动', location.href);

let mounted = false;
let visible = false;

async function mountSidebar(): Promise<void> {
  if (mounted) return;
  mounted = true;

  const shadow = ensureShadowHost();
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
  window.dispatchEvent(new CustomEvent('doc-assistant:visibility', { detail: { visible } }));
}

async function openSidebar(): Promise<void> {
  await mountSidebar();
  setVisible(true);
}

async function toggleSidebar(): Promise<void> {
  await mountSidebar();
  setVisible(!visible);
}

/** 监听来自 background 的消息 */
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === MessageType.TOGGLE_SIDEBAR) {
    void toggleSidebar().then(() => sendResponse({ type: MessageType.ACK, ok: true }));
    return true;
  }
  if (message.type === MessageType.OPEN_SIDEBAR) {
    void openSidebar().then(() => sendResponse({ type: MessageType.ACK, ok: true }));
    return true;
  }
  return false;
});

/** 划词工具条请求打开 sidebar */
window.addEventListener('doc-assistant:request-open', () => {
  void openSidebar();
});

/** 初始化划词工具条（独立于 sidebar 挂载，轻量常驻） */
initSelectionToolbar();
