/**
 * Service Worker 入口
 * ---------------------------------------------
 * 职责：
 * - 监听 action.onClicked：向当前 tab 的 content script 发送 TOGGLE_SIDEBAR
 * - 右键菜单：打开配置页
 * - 路由从 options / content 发来的运行时消息
 * - v0.2 新增：注册 `reflection-scan` chrome.alarms，每 60 分钟扫描待处理的反思任务
 *   v0.2.0 仅登记 alarm；v0.2.1 在 reflection-worker.ts 中实现真正的扫描/执行逻辑。
 */
import { createLogger, MessageType, type ExtensionMessage } from '@doc-assistant/shared';

const logger = createLogger('extension:background');

logger.info('service worker 启动');

/* ------------------------------------------------------------------ */
/* Toolbar / 右键 / 消息路由（MVP 行为保留）                            */
/* ------------------------------------------------------------------ */

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: MessageType.TOGGLE_SIDEBAR });
  } catch (err) {
    // 可能 content script 还未注入（特殊页面如 chrome:// 不注入），静默降级
    logger.warn('toggle sidebar 发送失败，可能是受限页面:', (err as Error).message);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'doc-assistant-open-options',
    title: 'Doc Assistant · 打开配置',
    contexts: ['action'],
  });

  // v0.2：注册反思扫描 alarm（60 分钟周期，首次 60 秒后触发）
  try {
    void chrome.alarms.create(REFLECTION_ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: 60,
    });
    logger.info(`注册 chrome.alarms: ${REFLECTION_ALARM_NAME}（60 分钟周期）`);
  } catch (err) {
    logger.warn('chrome.alarms.create 失败（可能环境不支持）', (err as Error).message);
  }
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'doc-assistant-open-options') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    switch (message.type) {
      case MessageType.OPEN_OPTIONS:
        chrome.runtime.openOptionsPage();
        sendResponse({ type: MessageType.ACK, ok: true });
        return false;
      default:
        return false;
    }
  },
);

/* ------------------------------------------------------------------ */
/* v0.2.1: chrome.alarms 反思扫描                                      */
/* ---                                                                 */
/* 架构决策（v0.2.1）：                                                 */
/* - IndexedDB 在 SW 与 sidebar 之间的同源隔离仍是风险点，因此本期       */
/*   选择"SW 只做唤醒、真正跑在 sidebar"的稳妥方案：                    */
/*   - alarm 触发 → chrome.runtime.sendMessage 广播 REFLECTION_SCAN_TICK */
/*   - 在线的 sidebar 收到后调用 ReflectionScheduler.runPending()       */
/*   - 没有 sidebar 在线时消息丢弃；下次打开 sidebar 会自动补跑         */
/* - 如果未来确认 SW 与 sidebar 同 origin 且 Dexie 可跨上下文共享，     */
/*   可以把执行器搬到 SW（见 docs/ROADMAP.md §2 附录）                  */
/* ------------------------------------------------------------------ */

export const REFLECTION_ALARM_NAME = 'doc-assistant.reflection-scan';

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== REFLECTION_ALARM_NAME) return;
  logger.info(`收到 alarm ${REFLECTION_ALARM_NAME} · 广播 REFLECTION_SCAN_TICK`);
  // fire-and-forget；无监听方时 chrome.runtime.sendMessage 会抛 "Could not establish connection"
  chrome.runtime
    .sendMessage({
      type: MessageType.REFLECTION_SCAN_TICK,
      at: Date.now(),
    })
    .catch((err: Error) => {
      // 绝大多数情况下是"sidebar 未在线"，属于预期；只打 debug 级日志
      logger.debug('REFLECTION_SCAN_TICK 无人接收（sidebar 未在线）', err.message);
    });
});
