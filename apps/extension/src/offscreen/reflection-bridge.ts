/**
 * Offscreen · 反思消息桥接（v0.5.0 PR-2）
 * ---------------------------------------------
 * 把 chrome.runtime.onMessage 的 REFLECTION_TICK / PAGE_VISIT_ENDED 事件
 * 桥接到 offscreen 内部的 `ReflectionScheduler`。
 *
 * 抽成独立模块的目的：
 * - 让 listener 的派发行为可以被单测直接验证（mock chrome.runtime / scheduler）
 * - offscreen/index.ts 只负责"拉起 runtime + 调用本模块挂 listener"的装配工作
 */
import { MessageType, createLogger } from '@doc-assistant/shared';
import type {
  PageVisitEndedMessage,
  ReflectionTickMessage,
} from '@doc-assistant/shared';
import type { ReflectionScheduler } from '@doc-assistant/agent';

const logger = createLogger('extension:offscreen:reflection');

/**
 * 极简版 chrome.runtime.onMessage，用于单测时注入 mock。
 * 真实环境传入 `chrome.runtime` 即可（类型兼容）。
 */
export interface RuntimeMessageBus {
  onMessage: {
    addListener(
      listener: (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ) => boolean | void,
    ): void;
  };
}

export interface ReflectionBridgeDeps {
  /**
   * 获取当前 scheduler 实例。
   * - 可能返回 null（配置中关闭了反思 / 构造失败），此时 listener 打 debug 日志并忽略消息
   * - 返回 Promise 是因为 offscreen 启动时 scheduler 可能还没就绪
   */
  getScheduler: () => Promise<ReflectionScheduler | null>;
  /** 可注入的日志，主要便于测试断言 */
  onTick?: (source: 'alarm' | 'page_visit_ended', visitId?: string) => void;
}

/**
 * 在给定消息总线上挂 REFLECTION_TICK / PAGE_VISIT_ENDED 两个 listener。
 *
 * - REFLECTION_TICK：调用 `scheduler.runPending()`
 * - PAGE_VISIT_ENDED：`scheduler.enqueueForVisit(visitId)` → `runPending()`
 *
 * Listener 全部返回 `false`（不拦截消息通道）。内部异步错误只打日志不抛出——
 * 避免 SW / Chrome runtime 看到 unhandled rejection。
 */
export function installReflectionBridge(
  bus: RuntimeMessageBus,
  deps: ReflectionBridgeDeps,
): void {
  bus.onMessage.addListener((message, _sender, _sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    const type = (message as { type?: unknown }).type;

    if (type === MessageType.REFLECTION_TICK) {
      const at = (message as ReflectionTickMessage).at;
      logger.info(`[reflection] tick source=alarm at=${at}`);
      deps.onTick?.('alarm');
      void (async () => {
        try {
          const scheduler = await deps.getScheduler();
          if (!scheduler) {
            logger.debug('收到 REFLECTION_TICK 但 scheduler 不可用（忽略）');
            return;
          }
          await scheduler.runPending();
        } catch (err) {
          logger.warn('REFLECTION_TICK 处理失败', (err as Error).message);
        }
      })();
      return false;
    }

    if (type === MessageType.PAGE_VISIT_ENDED) {
      const { visitId } = message as PageVisitEndedMessage;
      logger.info(`[reflection] tick source=page_visit_ended visitId=${visitId}`);
      deps.onTick?.('page_visit_ended', visitId);
      void (async () => {
        try {
          const scheduler = await deps.getScheduler();
          if (!scheduler) {
            logger.debug('收到 PAGE_VISIT_ENDED 但 scheduler 不可用（忽略）');
            return;
          }
          await scheduler.enqueueForVisit(visitId);
          await scheduler.runPending();
        } catch (err) {
          logger.warn('PAGE_VISIT_ENDED 处理失败', (err as Error).message);
        }
      })();
      return false;
    }

    return false;
  });
}
