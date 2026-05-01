/**
 * Service Worker 入口
 * ---------------------------------------------
 * 职责：
 * - 监听 action.onClicked：向当前 tab 的 content script 发送 TOGGLE_SIDEBAR
 * - 右键菜单：打开配置页
 * - 路由从 options / content 发来的运行时消息
 * - v0.2.1：注册 `reflection-scan` chrome.alarms
 * - v0.5.0 PR-2：alarm 触发时 `ensureOffscreenAlive()` + 转发 `REFLECTION_TICK`
 *   给 offscreen；sidebar 不再参与反思 Job 的执行。§8 的反思 tick 广播绕路
 *   （SW 唤醒 sidebar 跑 runPending）已删除。
 */
import { createLogger, MessageType, type ExtensionMessage } from '@doc-assistant/shared';
import {
  ensureOffscreenAlive,
  installMemoryRpcHook,
  verifyOffscreenAlive,
} from './memory-handler';

const logger = createLogger('extension:background');

logger.info('service worker 启动');

// v0.5.0：SW 冷启动时立即拉起 offscreen（不 await，缩短首条 RPC 延迟）
// 额外做一次启动自检日志（失败不阻塞 SW；RPC 路径仍会在收到 MEMORY_RPC_REQUEST
// 时重试 ensureOffscreenAlive），让用户在 SW Console 一眼能看到 offscreen 是否起来。
void verifyOffscreenAlive('sw-boot');
// v0.5.0：每次收到 MEMORY_RPC_REQUEST 前确保 offscreen 活着
installMemoryRpcHook();

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

  // v0.5.0：安装/更新时确保 offscreen 活着
  void ensureOffscreenAlive().catch((err: Error) => {
    logger.warn('onInstalled ensureOffscreenAlive 失败', err.message);
  });
});

// v0.5.0：浏览器启动时也拉起 offscreen，减少首次 RPC 冷启动延迟
chrome.runtime.onStartup.addListener(() => {
  logger.info('runtime.onStartup：确保 offscreen 活着');
  void ensureOffscreenAlive().catch((err: Error) => {
    logger.warn('onStartup ensureOffscreenAlive 失败', err.message);
  });
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
/* v0.5.0 · PR-2: chrome.alarms → offscreen REFLECTION_TICK 转发         */
/* ---                                                                   */
/* 架构决策（v0.5.0）：                                                  */
/* - Offscreen Document 是 DOM 上下文，MV3 不允许其监听 chrome.alarms.    */
/*   onAlarm（见 docs/requirements/v0.5.0-unified-memory.md §4 R4）      */
/* - 因此 SW 保留 alarm 监听，触发时：                                    */
/*     1. `ensureOffscreenAlive()` 确保 offscreen 活着                    */
/*     2. `chrome.runtime.sendMessage({ type: REFLECTION_TICK, at })`    */
/*     3. offscreen 端的 listener 调 `scheduler.runPending()`             */
/* - 与 §8 的老方案形似（都是"SW 广播"），但接收方从 sidebar 变成          */
/*   offscreen，offscreen 常驻、一定在线，不再有"sidebar 未开 → 消息      */
/*   丢失"的问题。                                                       */
/* ------------------------------------------------------------------ */

export const REFLECTION_ALARM_NAME = 'doc-assistant.reflection-scan';

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== REFLECTION_ALARM_NAME) return;
  logger.info(`收到 alarm ${REFLECTION_ALARM_NAME} · 转发 REFLECTION_TICK → offscreen`);
  void (async () => {
    try {
      await ensureOffscreenAlive();
      await chrome.runtime.sendMessage({
        type: MessageType.REFLECTION_TICK,
        at: Date.now(),
      });
    } catch (err) {
      // offscreen 未就绪 / listener 还没挂，偶发预期，debug 级日志
      logger.debug('REFLECTION_TICK 转发失败', (err as Error).message);
    }
  })();
});
