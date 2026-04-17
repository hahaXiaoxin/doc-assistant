/**
 * 统一日志封装
 * ---------------------------------------------
 * - 内部使用 console.* 输出，但外部代码应统一通过本文件的 createLogger 使用，避免裸 console 散布
 * - 分 level（debug/info/warn/error），通过 scope 前缀 `[scope]` 区分来源
 * - 安全要求：严禁打印 apiKey 与完整用户消息内容，请使用 maskSecret 对敏感字段脱敏
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

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
  const prefix = `[${scope}]`;

  const log = (level: LogLevel, args: unknown[]) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[globalMinLevel]) return;
    // eslint-disable-next-line no-console
    const fn = level === 'debug' ? console.debug : console[level];
    fn(prefix, ...args);
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
 * - 保留前 4 与后 4 字符，其余用 * 替代
 * - 短于 8 字符的一律返回 ****
 */
export function maskSecret(secret: string | undefined | null): string {
  if (!secret) return '';
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}
