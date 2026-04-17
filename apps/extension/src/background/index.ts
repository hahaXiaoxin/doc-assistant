/**
 * Service Worker 入口
 * ---------------------------------------------
 * 职责：
 * - 监听 action.onClicked：向当前 tab 的 content script 发送 TOGGLE_SIDEBAR
 * - 右键菜单：打开配置页
 * - 路由从 options / content 发来的运行时消息
 */
import { createLogger, MessageType, type ExtensionMessage } from '@doc-assistant/shared';

const logger = createLogger('extension:background');

logger.info('service worker 启动');

/**
 * 工具栏图标点击 → 切换侧边栏
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: MessageType.TOGGLE_SIDEBAR });
  } catch (err) {
    // 可能 content script 还未注入（特殊页面如 chrome:// 不注入），静默降级
    logger.warn('toggle sidebar 发送失败，可能是受限页面:', (err as Error).message);
  }
});

/**
 * 右键菜单：打开配置
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'doc-assistant-open-options',
    title: 'Doc Assistant · 打开配置',
    contexts: ['action'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'doc-assistant-open-options') {
    chrome.runtime.openOptionsPage();
  }
});

/**
 * 运行时消息路由
 */
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    switch (message.type) {
      case MessageType.OPEN_OPTIONS:
        chrome.runtime.openOptionsPage();
        sendResponse({ type: MessageType.ACK, ok: true });
        return false;
      default:
        // 其他消息交由其他 listener 处理；此处不阻塞
        return false;
    }
  },
);
