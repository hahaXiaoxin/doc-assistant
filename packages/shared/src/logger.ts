/**
 * 统一日志封装（v0.6.0 内测增强:ring buffer + persistor）
 * ---------------------------------------------
 * - 内部使用 console.* 输出,但外部代码应统一通过本文件的 createLogger 使用,避免裸 console 散布
 * - 分 level(debug/info/warn/error),通过 scope 前缀 `[scope]` 区分来源
 * - 安全要求:严禁打印 apiKey 与完整用户消息内容,请使用 maskSecret 对敏感字段脱敏
 *
 * v0.6.0 增强(Debug 导出链路):
 * - 模块级 ring buffer(默认 1000 条),追踪最近的日志供一键导出
 * - `getRecentLogs()` / `clearLogs()` / `exportLogs()` 读取或清空 buffer
 * - `setLogPersistor(fn)` 注入持久化钩子(offscreen 注册后,所有 ring buffer 日志异步写入 IDB)
 *   - sidebar / SW / options 通过 RPC 批量 flush 给 offscreen
 *   - offscreen 自身直接写本地 IDB
 *
 * 约束:
 * - createLogger / setLogLevel / maskSecret 原签名不变,不破坏已有调用
 * - persistor 失败只 console.warn,不抛错(日志是旁路能力)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let globalMinLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  globalMinLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalMinLevel;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(scope: string): Logger;
}

/** ring buffer 中存储的日志条目(序列化友好)。 */
export interface LogEntry {
  /** 毫秒级时间戳 */
  ts: number;
  level: LogLevel;
  /** 完整 scope(含 child 链,如 `extension:offscreen:memory`) */
  module: string;
  /** 合并后的消息字符串(args 用 String(v) 拼接) */
  msg: string;
  /** 结构化 meta(若 args 最后一项是 plain object 则提取;否则为 undefined) */
  meta?: Record<string, unknown> | undefined;
}

/**
 * 持久化钩子。
 * - offscreen 侧:直接写 IDB
 * - 其他上下文:批量通过 RPC flush 给 offscreen
 * 参数是 **增量** 的 entries(自上次调用起的新日志),实现方自行负责 dedup。
 */
export type LogPersistor = (entries: LogEntry[]) => void | Promise<void>;

const RING_CAPACITY = 1000;
/** 模块级 ring buffer(覆盖式环形) */
const ringBuffer: LogEntry[] = [];
let persistor: LogPersistor | null = null;
/** 暂存尚未 flush 给 persistor 的新 entries */
let pendingFlush: LogEntry[] = [];
let flushScheduled = false;
/** 批量 flush 的防抖延迟(毫秒) */
const FLUSH_DEBOUNCE_MS = 500;

/**
 * 注入持久化钩子。
 * - 可多次调用以替换;传 null 则停止持久化
 * - 注入时会立即 flush 一次已积压的 entries(避免冷启动日志丢失)
 */
export function setLogPersistor(fn: LogPersistor | null): void {
  persistor = fn;
  if (fn && pendingFlush.length > 0) {
    scheduleFlush();
  }
}

/** 读取 ring buffer 快照(按时间升序) */
export function getRecentLogs(limit?: number): LogEntry[] {
  const snapshot = ringBuffer.slice();
  if (limit && limit > 0 && limit < snapshot.length) {
    return snapshot.slice(snapshot.length - limit);
  }
  return snapshot;
}

/** 清空 ring buffer(不影响 persistor 端已落盘数据) */
export function clearLogs(): void {
  ringBuffer.length = 0;
  pendingFlush.length = 0;
}

/** 导出 ring buffer 为 JSON 友好的数组(深拷贝,调用方可安全修改) */
export function exportLogs(): LogEntry[] {
  return ringBuffer.map((e) => {
    const copy: LogEntry = { ts: e.ts, level: e.level, module: e.module, msg: e.msg };
    if (e.meta) copy.meta = { ...e.meta };
    return copy;
  });
}

function scheduleFlush(): void {
  if (flushScheduled || !persistor) return;
  flushScheduled = true;
  const delayMs = FLUSH_DEBOUNCE_MS;
  const fire = (): void => {
    flushScheduled = false;
    if (!persistor || pendingFlush.length === 0) return;
    const batch = pendingFlush;
    pendingFlush = [];
    try {
      const ret = persistor(batch);
      if (ret && typeof (ret as Promise<void>).catch === 'function') {
        (ret as Promise<void>).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('[logger] persistor rejected:', (err as Error).message);
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[logger] persistor threw:', (err as Error).message);
    }
  };
  if (typeof setTimeout === 'function') {
    setTimeout(fire, delayMs);
  } else {
    // 无 timer 环境(极罕见)直接同步 fire
    fire();
  }
}

/** 尝试把 args 最后一项提取为结构化 meta(仅 plain object,不含 Error/Array) */
function extractMeta(args: unknown[]): Record<string, unknown> | undefined {
  if (args.length === 0) return undefined;
  const last = args[args.length - 1];
  if (
    last &&
    typeof last === 'object' &&
    !Array.isArray(last) &&
    !(last instanceof Error) &&
    Object.getPrototypeOf(last) === Object.prototype
  ) {
    // 仅做浅拷贝;深层 value 由 JSON.stringify 兜底
    return { ...(last as Record<string, unknown>) };
  }
  return undefined;
}

function stringifyArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.message;
      if (a === null || a === undefined) return String(a);
      if (typeof a === 'string') return a;
      if (typeof a === 'number' || typeof a === 'boolean') return String(a);
      try {
        return JSON.stringify(a);
      } catch {
        return '[Unserializable]';
      }
    })
    .join(' ');
}

function pushToRing(entry: LogEntry): void {
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_CAPACITY) {
    ringBuffer.splice(0, ringBuffer.length - RING_CAPACITY);
  }
  pendingFlush.push(entry);
  if (persistor) scheduleFlush();
}

export function createLogger(scope: string): Logger {
  const prefix = `[${scope}]`;

  const log = (level: LogLevel, args: unknown[]): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[globalMinLevel]) return;
    // eslint-disable-next-line no-console
    const fn = level === 'debug' ? console.debug : console[level];
    fn(prefix, ...args);
    // 记录到 ring buffer(级别不受 globalMinLevel 限制;即便关闭 debug,也想抓到所有 warn/error)
    // 这里保持与 console 同步:只记录 >= globalMinLevel 的,避免 ring 被 debug 噪音打满
    const meta = extractMeta(args);
    const msg = stringifyArgs(args);
    const entry: LogEntry = { ts: Date.now(), level, module: scope, msg };
    if (meta) entry.meta = meta;
    pushToRing(entry);
  };

  return {
    debug: (...args) => log('debug', args),
    info: (...args) => log('info', args),
    warn: (...args) => log('warn', args),
    error: (...args) => log('error', args),
    child(sub) {
      return createLogger(`${scope}:${sub}`);
    },
  };
}

/**
 * 对敏感字符串做脱敏。
 * - 保留前 4 与后 4 字符,其余用 * 替代
 * - 短于 8 字符的一律返回 ****
 */
export function maskSecret(secret: string | undefined | null): string {
  if (!secret) return '';
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

/** 单测工具:强制 flush pending 队列(生产勿用) */
export function __flushLogsForTest(): void {
  if (!persistor) return;
  const batch = pendingFlush;
  pendingFlush = [];
  try {
    const ret = persistor(batch);
    if (ret && typeof (ret as Promise<void>).catch === 'function') {
      (ret as Promise<void>).catch(() => {
        /* swallow */
      });
    }
  } catch {
    /* swallow in test helper */
  }
}
