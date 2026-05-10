import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createLogger,
  setLogLevel,
  getRecentLogs,
  clearLogs,
  exportLogs,
  setLogPersistor,
  __flushLogsForTest,
} from '../logger';

describe('logger · ring buffer', () => {
  beforeEach(() => {
    clearLogs();
    setLogLevel('debug');
    setLogPersistor(null);
  });

  it('createLogger 记录 info/warn/error 到 ring buffer', () => {
    const log = createLogger('test:scope');
    log.info('hello', 'world');
    log.warn('careful');
    log.error('boom');

    const entries = getRecentLogs();
    expect(entries).toHaveLength(3);
    expect(entries[0]!).toMatchObject({
      level: 'info',
      module: 'test:scope',
      msg: 'hello world',
    });
    expect(entries[1]!.level).toBe('warn');
    expect(entries[2]!.level).toBe('error');
  });

  it('低于 globalMinLevel 的日志不进 buffer', () => {
    setLogLevel('warn');
    const log = createLogger('test:scope');
    log.debug('hidden');
    log.info('hidden2');
    log.warn('shown');
    expect(getRecentLogs()).toHaveLength(1);
    expect(getRecentLogs()[0]!.level).toBe('warn');
  });

  it('超出 ring capacity 时保留最近 1000 条', () => {
    const log = createLogger('test:cap');
    for (let i = 0; i < 1200; i++) {
      log.info(`entry-${i}`);
    }
    const entries = getRecentLogs();
    expect(entries).toHaveLength(1000);
    expect(entries[0]!.msg).toBe('entry-200');
    expect(entries[999]!.msg).toBe('entry-1199');
  });

  it('最后一项是 plain object 时被提取为 meta', () => {
    const log = createLogger('test:meta');
    log.info('action', { userId: 'u1', count: 3 });
    const [entry] = getRecentLogs();
    expect(entry!.meta).toEqual({ userId: 'u1', count: 3 });
  });

  it('Error 对象不被误判为 meta', () => {
    const log = createLogger('test:err');
    log.error('failed', new Error('boom'));
    const [entry] = getRecentLogs();
    expect(entry!.meta).toBeUndefined();
    expect(entry!.msg).toContain('boom');
  });

  it('exportLogs 返回深拷贝', () => {
    const log = createLogger('test:copy');
    log.info('msg', { a: 1 });
    const exported = exportLogs();
    (exported[0]!.meta as { a: number }).a = 999;
    const fresh = getRecentLogs();
    expect((fresh[0]!.meta as { a: number }).a).toBe(1);
  });

  it('clearLogs 清空 buffer', () => {
    const log = createLogger('test:clear');
    log.info('x');
    log.info('y');
    expect(getRecentLogs()).toHaveLength(2);
    clearLogs();
    expect(getRecentLogs()).toHaveLength(0);
  });
});

describe('logger · persistor', () => {
  beforeEach(() => {
    clearLogs();
    setLogLevel('debug');
    setLogPersistor(null);
    vi.useRealTimers();
  });

  it('注入 persistor 后新日志触发异步 flush', async () => {
    const spy = vi.fn();
    setLogPersistor(spy);
    const log = createLogger('test:p');
    log.info('one');
    log.info('two');
    // 等待 debounce (500ms)
    await new Promise((r) => setTimeout(r, 600));
    expect(spy).toHaveBeenCalledTimes(1);
    const batch = spy.mock.calls[0]![0] as Array<{ msg: string }>;
    expect(batch).toHaveLength(2);
    expect(batch[0]!.msg).toBe('one');
    expect(batch[1]!.msg).toBe('two');
  });

  it('persistor 抛错不影响 logger', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setLogPersistor(() => {
      throw new Error('persistor-fail');
    });
    const log = createLogger('test:pthrow');
    log.info('msg');
    __flushLogsForTest();
    // ring buffer 里依然有记录
    expect(getRecentLogs()).toHaveLength(1);
    consoleWarn.mockRestore();
  });

  it('setLogPersistor(null) 停止 flush', async () => {
    const spy = vi.fn();
    setLogPersistor(spy);
    const log = createLogger('test:pstop');
    log.info('a');
    setLogPersistor(null);
    log.info('b');
    await new Promise((r) => setTimeout(r, 600));
    // 第一个日志可能/可能不被 flush;关键是 setLogPersistor(null) 后不再调用
    // 第二次 log 不会触发新的 flush
    if (spy.mock.calls.length > 0) {
      const calls = spy.mock.calls.flat(2);
      const msgs = calls.map((e: { msg: string }) => e.msg);
      expect(msgs).not.toContain('b');
    }
  });
});
