/**
 * Offscreen · 日志持久化桥接(v0.6.0)
 * ---------------------------------------------
 * 把 chrome.runtime.onMessage 的 LOG_PERSIST_REQUEST / LOG_EXPORT_REQUEST
 * 桥接到独立的 Dexie `logs` 表。
 *
 * - 独立 DB 名 `doc-assistant-logs`,不侵入 memory DB
 * - 表 `logs`:自增 `id`,其余 ts/level/module/msg/meta
 * - 写入采用 bulkAdd,容量超过 `MAX_ROWS`(10000)时从头部批量截断,防止 IDB 爆炸
 * - 读取按 id 倒序取最近 N 条后再正序返回(时间排序一致)
 *
 * 与 reflection-bridge 并列:offscreen/index.ts 启动时挂 listener。
 */
import Dexie, { type Table } from 'dexie';
import {
  MessageType,
  createLogger,
  type LogExportRequest,
  type LogExportResponse,
  type LogPersistRequest,
  type LogPersistResponse,
  type LogRpcEntry,
} from '@doc-assistant/shared';

const logger = createLogger('extension:offscreen:logs');

const DB_NAME = 'doc-assistant-logs';
const MAX_ROWS = 10_000;
const DEFAULT_EXPORT_LIMIT = 5000;
const MAX_EXPORT_LIMIT = 5000;

interface LogRow {
  id?: number;
  ts: number;
  level: string;
  module: string;
  msg: string;
  meta?: Record<string, unknown>;
  origin: string;
}

class LogsDatabase extends Dexie {
  logs!: Table<LogRow, number>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      logs: '++id, ts, level, module, origin',
    });
  }
}

let dbInstance: LogsDatabase | null = null;

function getDb(): LogsDatabase {
  if (!dbInstance) dbInstance = new LogsDatabase();
  return dbInstance;
}

/** 插入一批日志条目,并在超过 MAX_ROWS 时截断最早的 */
async function appendLogs(entries: LogRpcEntry[], origin: string): Promise<number> {
  if (entries.length === 0) return 0;
  const db = getDb();
  const rows: LogRow[] = entries.map((e) => {
    const row: LogRow = {
      ts: e.ts,
      level: e.level,
      module: e.module,
      msg: e.msg,
      origin,
    };
    if (e.meta) row.meta = e.meta;
    return row;
  });
  await db.logs.bulkAdd(rows);
  // 超额截断:按 id 升序删除最老的
  const total = await db.logs.count();
  if (total > MAX_ROWS) {
    const excess = total - MAX_ROWS;
    const oldKeys = await db.logs.orderBy('id').limit(excess).primaryKeys();
    await db.logs.bulkDelete(oldKeys);
  }
  return rows.length;
}

/** 读取最近 N 条(按 ts 升序返回;默认/上限 5000) */
async function readRecentLogs(limit = DEFAULT_EXPORT_LIMIT): Promise<LogRpcEntry[]> {
  const effective = Math.min(Math.max(limit, 1), MAX_EXPORT_LIMIT);
  const db = getDb();
  // reverse 后 limit 最新 N 条 → 再反转回时间升序
  const rowsDesc = await db.logs.orderBy('id').reverse().limit(effective).toArray();
  return rowsDesc.reverse().map((r) => {
    const entry: LogRpcEntry = {
      ts: r.ts,
      level: r.level as LogRpcEntry['level'],
      module: r.module,
      msg: r.msg,
    };
    if (r.meta) entry.meta = r.meta;
    return entry;
  });
}

export interface LogBridgeBus {
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

/**
 * 在给定消息总线上挂 LOG_PERSIST_REQUEST / LOG_EXPORT_REQUEST 两个 listener。
 * - LOG_PERSIST:追加到 Dexie logs;累积到 MAX_ROWS 时截断最老的
 * - LOG_EXPORT:返回最近 5000 条(ts 升序)
 *
 * Listener 异步处理时返回 true 以保留 sendResponse 通道。
 */
export function installLogBridge(bus: LogBridgeBus): void {
  bus.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    const type = (message as { type?: unknown }).type;

    if (type === MessageType.LOG_PERSIST_REQUEST) {
      const req = message as LogPersistRequest;
      void (async () => {
        try {
          const accepted = await appendLogs(req.entries ?? [], req.origin ?? 'unknown');
          sendResponse({
            type: MessageType.LOG_PERSIST_RESPONSE,
            rpcId: req.rpcId,
            ok: true,
            accepted,
          } satisfies LogPersistResponse);
        } catch (err) {
          logger.warn('LOG_PERSIST 写入失败', (err as Error).message);
          sendResponse({
            type: MessageType.LOG_PERSIST_RESPONSE,
            rpcId: req.rpcId,
            ok: false,
            error: { message: (err as Error).message },
          } satisfies LogPersistResponse);
        }
      })();
      return true;
    }

    if (type === MessageType.LOG_EXPORT_REQUEST) {
      const req = message as LogExportRequest;
      void (async () => {
        try {
          const entries = await readRecentLogs(req.limit);
          sendResponse({
            type: MessageType.LOG_EXPORT_RESPONSE,
            rpcId: req.rpcId,
            ok: true,
            entries,
          } satisfies LogExportResponse);
        } catch (err) {
          logger.warn('LOG_EXPORT 读取失败', (err as Error).message);
          sendResponse({
            type: MessageType.LOG_EXPORT_RESPONSE,
            rpcId: req.rpcId,
            ok: false,
            error: { message: (err as Error).message },
          } satisfies LogExportResponse);
        }
      })();
      return true;
    }

    return false;
  });
}

/** 单测用:清空 logs 表 */
export async function __resetLogsDbForTest(): Promise<void> {
  const db = getDb();
  await db.logs.clear();
}

/**
 * 直接落盘(不走 RPC)。
 * - offscreen 自己的 logger persistor 用这个
 * - 行为与 LOG_PERSIST_REQUEST handler 完全一致,只是少了 sendMessage 的一跳
 */
export async function persistLogsDirectly(
  entries: LogRpcEntry[],
  origin: string,
): Promise<number> {
  return appendLogs(entries, origin);
}
