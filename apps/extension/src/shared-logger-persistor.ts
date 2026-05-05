/**
 * Log Persistor · 远程(经 chrome.runtime)
 * ---------------------------------------------
 * sidebar / SW / options 三个上下文都不是 offscreen,自己没拿到 IDB 锁(或者
 * 直接说:不该写 offscreen 的 logs 表);统一通过 chrome.runtime.sendMessage
 * 把批量日志推给 offscreen 落盘。
 *
 * 使用:
 * ```ts
 *   import { setLogPersistor } from '@doc-assistant/shared';
 *   setLogPersistor(createRemoteLogPersistor('sidebar'));
 * ```
 *
 * 约束:
 * - 单次 RPC 限流:batch > 200 时拆成多次发送
 * - 任何错误只 console.warn,不抛(日志是旁路)
 * - chrome.runtime 不可用(测试环境)时 no-op
 */
import {
  MessageType,
  type LogEntry,
  type LogPersistRequest,
  type LogPersistResponse,
  type LogPersistor,
  type LogRpcEntry,
} from '@doc-assistant/shared';

const BATCH_LIMIT = 200;

function isChromeRuntimeAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    typeof chrome.runtime.sendMessage === 'function'
  );
}

function toRpcEntry(e: LogEntry): LogRpcEntry {
  const out: LogRpcEntry = {
    ts: e.ts,
    level: e.level,
    module: e.module,
    msg: e.msg,
  };
  if (e.meta) out.meta = e.meta;
  return out;
}

/**
 * 构造一个可直接喂给 `setLogPersistor(...)` 的持久化钩子。
 *
 * @param origin 用于标识来源(如 "sidebar" / "sw" / "options")
 */
export function createRemoteLogPersistor(origin: string): LogPersistor {
  return async (entries) => {
    if (!isChromeRuntimeAvailable() || entries.length === 0) return;

    for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
      const batch = entries.slice(i, i + BATCH_LIMIT).map(toRpcEntry);
      const rpcId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const req: LogPersistRequest = {
        type: MessageType.LOG_PERSIST_REQUEST,
        rpcId,
        entries: batch,
        origin,
      };
      try {
        const resp = (await chrome.runtime.sendMessage(req)) as LogPersistResponse | undefined;
        if (!resp || resp.ok === false) {
          // eslint-disable-next-line no-console
          console.warn(
            '[log-persistor] offscreen 拒绝或未响应',
            resp?.error?.message ?? 'no-response',
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[log-persistor] sendMessage 失败', (err as Error).message);
      }
    }
  };
}
