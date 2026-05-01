/**
 * 单测：SW memory-handler
 * ---------------------------------------------
 * 核心红线（v0.5.0 真机踩坑经验）：
 * - `installMemoryRpcHook` 挂在 SW 的 `chrome.runtime.onMessage` 上，**不得**声明异步
 *   响应（return true）或 `sendResponse(...)`——否则 Chrome 会把 offscreen 的真实
 *   response 丢弃，sidebar 收到 undefined 并触发 "unexpected RPC response shape"。
 * - 收到 MEMORY_RPC_REQUEST 时必须 fire-and-forget 触发 ensureOffscreenAlive，以便
 *   覆盖 SW 冷启动窗口（offscreen 尚未挂 listener）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '@doc-assistant/shared';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (resp?: unknown) => void,
) => boolean | void;

interface ChromeMock {
  runtime: {
    onMessage: {
      addListener: (l: Listener) => void;
      _listeners: Listener[];
    };
  };
  offscreen: {
    hasDocument: ReturnType<typeof vi.fn>;
    createDocument: ReturnType<typeof vi.fn>;
  };
}

function setupChromeMock(): ChromeMock {
  const listeners: Listener[] = [];
  const mock: ChromeMock = {
    runtime: {
      onMessage: {
        addListener: (l: Listener) => {
          listeners.push(l);
        },
        _listeners: listeners,
      },
    },
    offscreen: {
      hasDocument: vi.fn().mockResolvedValue(true),
      createDocument: vi.fn().mockResolvedValue(undefined),
    },
  };
  (globalThis as unknown as { chrome: ChromeMock }).chrome = mock;
  return mock;
}

async function importFresh(): Promise<typeof import('../memory-handler')> {
  vi.resetModules();
  return await import('../memory-handler');
}

describe('memory-handler · installMemoryRpcHook 契约', () => {
  let prevChrome: unknown;

  beforeEach(() => {
    prevChrome = (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  afterEach(() => {
    (globalThis as unknown as { chrome?: unknown }).chrome = prevChrome;
    vi.restoreAllMocks();
  });

  it('MEMORY_RPC_REQUEST listener 同步返回 false（不占用 sendResponse 通道）', async () => {
    const mock = setupChromeMock();
    const mod = await importFresh();
    mod.installMemoryRpcHook();

    const listener = mock.runtime.onMessage._listeners[0]!;
    const sendResponse = vi.fn();

    const result = listener(
      { type: MessageType.MEMORY_RPC_REQUEST, rpcId: 'r1', method: 'recall', args: [{}] },
      {},
      sendResponse,
    );

    // 红线 1：必须同步返回 false（Chrome 才会允许其他 listener 的 sendResponse 生效）
    expect(result).toBe(false);
    // 红线 2：绝不能调用 sendResponse（否则 offscreen 的 response 会被覆盖）
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('非 MEMORY_RPC_REQUEST 消息不触发 ensureOffscreenAlive（listener 仍 return false）', async () => {
    const mock = setupChromeMock();
    const mod = await importFresh();
    mod.installMemoryRpcHook();

    const listener = mock.runtime.onMessage._listeners[0]!;
    const result = listener({ type: 'doc-assistant/ack' }, {}, vi.fn());

    expect(result).toBe(false);
    expect(mock.offscreen.hasDocument).not.toHaveBeenCalled();
    expect(mock.offscreen.createDocument).not.toHaveBeenCalled();
  });

  it('MEMORY_RPC_REQUEST 触发 ensureOffscreenAlive（fire-and-forget，不阻塞 listener）', async () => {
    const mock = setupChromeMock();
    // offscreen 还不存在，迫使 createDocument 被调
    mock.offscreen.hasDocument.mockResolvedValue(false);

    const mod = await importFresh();
    mod.installMemoryRpcHook();

    const listener = mock.runtime.onMessage._listeners[0]!;
    // listener 必须同步 return false，不能 await ensureOffscreenAlive
    const t0 = Date.now();
    const result = listener(
      { type: MessageType.MEMORY_RPC_REQUEST, rpcId: 'r2', method: 'remember', args: [] },
      {},
      vi.fn(),
    );
    expect(result).toBe(false);
    expect(Date.now() - t0).toBeLessThan(50); // 同步返回

    // 等 microtask/promise 回调跑完，确认 ensureOffscreenAlive 确实被触发
    await new Promise((r) => setTimeout(r, 0));
    expect(mock.offscreen.hasDocument).toHaveBeenCalled();
    expect(mock.offscreen.createDocument).toHaveBeenCalled();
  });

  it('ensureOffscreenAlive 抛错时 listener 不传染（只打日志）', async () => {
    const mock = setupChromeMock();
    mock.offscreen.hasDocument.mockResolvedValue(false);
    mock.offscreen.createDocument.mockRejectedValue(new Error('boom'));

    const mod = await importFresh();
    mod.installMemoryRpcHook();

    const listener = mock.runtime.onMessage._listeners[0]!;
    const result = listener(
      { type: MessageType.MEMORY_RPC_REQUEST, rpcId: 'r3', method: 'recall', args: [{}] },
      {},
      vi.fn(),
    );
    expect(result).toBe(false);

    // 等一轮 microtask 让 .catch 跑完；不应该有 unhandled rejection
    await new Promise((r) => setTimeout(r, 0));
  });

  it('ensureOffscreenAlive 幂等（hasDocument=true 时不再 createDocument）', async () => {
    const mock = setupChromeMock();
    mock.offscreen.hasDocument.mockResolvedValue(true);

    const mod = await importFresh();
    await mod.ensureOffscreenAlive();
    await mod.ensureOffscreenAlive();

    expect(mock.offscreen.hasDocument).toHaveBeenCalledTimes(2);
    expect(mock.offscreen.createDocument).not.toHaveBeenCalled();
  });

  /**
   * 红线（v0.5.0 真机修复 · "offscreen 从未启动"）：
   * createDocument 的 reasons 里任何非法 enum 值都会让 Chrome 直接抛错 →
   * offscreen 永远起不来 → sidebar RPC 报 "unexpected RPC response shape"。
   * 合法值见 chrome.offscreen.Reason（TESTING / AUDIO_PLAYBACK / IFRAME_SCRIPTING /
   * DOM_SCRAPING / BLOBS / DOM_PARSER / USER_MEDIA / DISPLAY_MEDIA / WEB_RTC /
   * CLIPBOARD / LOCAL_STORAGE / WORKERS / BATTERY_STATUS / MATCH_MEDIA / GEOLOCATION）。
   * 我们用 LOCAL_STORAGE（IDB 与 localStorage 同属 storage partition）。
   */
  it('createDocument 使用合法 reason（LOCAL_STORAGE，非 IDB_PERSISTENCE）', async () => {
    const mock = setupChromeMock();
    mock.offscreen.hasDocument.mockResolvedValue(false);

    const mod = await importFresh();
    await mod.ensureOffscreenAlive();

    expect(mock.offscreen.createDocument).toHaveBeenCalledTimes(1);
    const params = mock.offscreen.createDocument.mock.calls[0]![0] as {
      url: string;
      reasons: string[];
      justification: string;
    };
    expect(params.url).toBe('src/offscreen/offscreen.html');
    expect(params.reasons).toEqual(['LOCAL_STORAGE']);
    expect(params.reasons).not.toContain('IDB_PERSISTENCE');
    expect(params.justification.length).toBeGreaterThan(0);
  });

  it('verifyOffscreenAlive 返回 true 当 hasDocument=true（启动自检日志路径）', async () => {
    const mock = setupChromeMock();
    mock.offscreen.hasDocument.mockResolvedValue(true);

    const mod = await importFresh();
    const ok = await mod.verifyOffscreenAlive('test');

    expect(ok).toBe(true);
  });

  it('verifyOffscreenAlive 在 createDocument 失败时返回 false（不抛）', async () => {
    const mock = setupChromeMock();
    mock.offscreen.hasDocument.mockResolvedValue(false);
    mock.offscreen.createDocument.mockRejectedValue(new Error('Invalid reason'));

    const mod = await importFresh();
    const ok = await mod.verifyOffscreenAlive('test');

    expect(ok).toBe(false);
  });
});
