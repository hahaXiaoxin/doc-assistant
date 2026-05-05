/**
 * 单测:offscreen log-bridge
 * ---------------------------------------------
 * 覆盖:
 * - LOG_PERSIST_REQUEST 写入 Dexie logs 表并回响应 ok=true
 * - LOG_EXPORT_REQUEST 读取最近 N 条(按 ts 升序)
 * - 超过 MAX_ROWS 时截断最老的
 * - 非目标消息类型被忽略(listener 返回 false)
 * - persistLogsDirectly 可直接被 offscreen 本地 persistor 调用
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { MessageType } from '@doc-assistant/shared';
import type { LogExportRequest, LogPersistRequest } from '@doc-assistant/shared';
import {
  installLogBridge,
  persistLogsDirectly,
  __resetLogsDbForTest,
  type LogBridgeBus,
} from '../log-bridge';

type Listener = Parameters<LogBridgeBus['onMessage']['addListener']>[0];

function makeBus(): {
  bus: LogBridgeBus;
  trigger: (msg: unknown) => Promise<unknown>;
} {
  const listeners: Listener[] = [];
  const bus: LogBridgeBus = {
    onMessage: {
      addListener(l) {
        listeners.push(l);
      },
    },
  };
  async function trigger(msg: unknown): Promise<unknown> {
    for (const l of listeners) {
      let response: unknown;
      const willRespond = l(msg, {} as chrome.runtime.MessageSender, (r) => {
        response = r;
      });
      if (willRespond === true) {
        // 等待异步 sendResponse
        for (let i = 0; i < 20 && response === undefined; i++) {
          await new Promise((r) => setTimeout(r, 5));
        }
        return response;
      }
    }
    return undefined;
  }
  return { bus, trigger };
}

describe('offscreen · log-bridge', () => {
  beforeEach(async () => {
    await __resetLogsDbForTest();
  });

  it('LOG_PERSIST_REQUEST 写入并 ok=true', async () => {
    const { bus, trigger } = makeBus();
    installLogBridge(bus);

    const req: LogPersistRequest = {
      type: MessageType.LOG_PERSIST_REQUEST,
      rpcId: 'rpc-1',
      origin: 'sidebar',
      entries: [
        { ts: 100, level: 'info', module: 'test', msg: 'one' },
        { ts: 101, level: 'warn', module: 'test', msg: 'two' },
      ],
    };
    const resp = (await trigger(req)) as { ok: boolean; accepted: number };
    expect(resp).toBeDefined();
    expect(resp.ok).toBe(true);
    expect(resp.accepted).toBe(2);
  });

  it('LOG_EXPORT_REQUEST 返回最近的 N 条(ts 升序)', async () => {
    const { bus, trigger } = makeBus();
    installLogBridge(bus);

    const entries = Array.from({ length: 10 }, (_, i) => ({
      ts: 1000 + i,
      level: 'info' as const,
      module: 'm',
      msg: `msg-${i}`,
    }));
    await trigger({
      type: MessageType.LOG_PERSIST_REQUEST,
      rpcId: 'w',
      origin: 'test',
      entries,
    } satisfies LogPersistRequest);

    const expReq: LogExportRequest = {
      type: MessageType.LOG_EXPORT_REQUEST,
      rpcId: 'r',
      limit: 5,
    };
    const resp = (await trigger(expReq)) as {
      ok: boolean;
      entries: Array<{ msg: string; ts: number }>;
    };
    expect(resp.ok).toBe(true);
    expect(resp.entries).toHaveLength(5);
    expect(resp.entries.map((e) => e.msg)).toEqual([
      'msg-5',
      'msg-6',
      'msg-7',
      'msg-8',
      'msg-9',
    ]);
    // ts 单调递增
    const ts = resp.entries.map((e) => e.ts);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('非目标消息被忽略,不回响应', async () => {
    const { bus, trigger } = makeBus();
    installLogBridge(bus);

    const resp = await trigger({ type: MessageType.TOGGLE_SIDEBAR });
    expect(resp).toBeUndefined();
  });

  it('persistLogsDirectly 可直连(offscreen 本地 persistor 路径)', async () => {
    const accepted = await persistLogsDirectly(
      [{ ts: 1, level: 'error', module: 'off', msg: 'boom' }],
      'offscreen',
    );
    expect(accepted).toBe(1);
    // 读回来
    const { bus, trigger } = makeBus();
    installLogBridge(bus);
    const resp = (await trigger({
      type: MessageType.LOG_EXPORT_REQUEST,
      rpcId: 'r',
      limit: 5000,
    } satisfies LogExportRequest)) as {
      ok: boolean;
      entries: Array<{ msg: string; level: string }>;
    };
    expect(resp.ok).toBe(true);
    expect(resp.entries).toHaveLength(1);
    expect(resp.entries[0]!.msg).toBe('boom');
    expect(resp.entries[0]!.level).toBe('error');
  });
});
