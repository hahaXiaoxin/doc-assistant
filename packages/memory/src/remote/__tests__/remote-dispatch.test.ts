/**
 * 单测：dispatchMemoryRpc（offscreen router 的核心）
 * ---------------------------------------------
 * 覆盖：
 * - 白名单：未知 method → ok=false
 * - happy path：22 条合法 method 全部成功透传到 store
 * - store 抛错：error.message / error.stack 序列化
 * - 消息类型守卫 `isMemoryRpcRequest`
 */
import { describe, it, expect, vi } from 'vitest';
import { MessageType, type MemoryRpcRequest } from '@doc-assistant/shared';
import {
  dispatchMemoryRpc,
  isMemoryRpcRequest,
  MEMORY_RPC_METHODS,
} from '../remote-dispatch';
import type { MemoryStore } from '../../interface';

function makeRequest(
  method: MemoryRpcRequest['method'],
  args: unknown[] = [],
  rpcId = 'rpc-1',
): MemoryRpcRequest {
  return { type: MessageType.MEMORY_RPC_REQUEST, rpcId, method, args };
}

type FakeStore = Record<string, ReturnType<typeof vi.fn>>;

/** 生成一个所有 22 条方法都是 vi.fn() 的假 store */
function makeFakeStore(): FakeStore {
  const entries: Array<[string, ReturnType<typeof vi.fn>]> = [];
  for (const m of MEMORY_RPC_METHODS) {
    entries.push([m, vi.fn().mockResolvedValue(undefined)]);
  }
  return Object.fromEntries(entries) as FakeStore;
}

describe('isMemoryRpcRequest', () => {
  it('识别合法 envelope', () => {
    expect(isMemoryRpcRequest(makeRequest('close'))).toBe(true);
  });
  it('拒绝非对象/非 memory type 的 msg', () => {
    expect(isMemoryRpcRequest(null)).toBe(false);
    expect(isMemoryRpcRequest('hello')).toBe(false);
    expect(isMemoryRpcRequest({ type: 'doc-assistant/ack' })).toBe(false);
    expect(isMemoryRpcRequest({})).toBe(false);
  });
});

describe('dispatchMemoryRpc · 白名单守卫', () => {
  it('未知 method 直接 ok=false', async () => {
    const store = makeFakeStore() as unknown as MemoryStore;
    const resp = await dispatchMemoryRpc(store, {
      type: MessageType.MEMORY_RPC_REQUEST,
      rpcId: 'rpc-x',
      method: 'bogusMethod' as never,
      args: [],
    });
    expect(resp.ok).toBe(false);
    expect(resp.error?.message).toMatch(/unknown memory RPC method/);
    expect(resp.rpcId).toBe('rpc-x');
  });

  it('store 上缺失 method（理论上不应发生）时 ok=false', async () => {
    // 白名单方法，但 store 上手动移除
    const store = makeFakeStore();
    delete (store as Record<string, unknown>).remember;
    const resp = await dispatchMemoryRpc(
      store as unknown as MemoryStore,
      makeRequest('remember', [{ id: 'x', type: 'message', content: 'c', timestamp: 0 }]),
    );
    expect(resp.ok).toBe(false);
    expect(resp.error?.message).toMatch(/missing method/);
  });
});

describe('dispatchMemoryRpc · 22 条合法 method', () => {
  it.each(Array.from(MEMORY_RPC_METHODS))('%s 被正确派发到 store', async (method) => {
    const store = makeFakeStore();
    store[method]!.mockResolvedValue('result-' + method);
    const resp = await dispatchMemoryRpc(
      store as unknown as MemoryStore,
      makeRequest(method, ['a', 'b']),
    );
    expect(store[method]).toHaveBeenCalledWith('a', 'b');
    expect(resp.ok).toBe(true);
    expect(resp.result).toBe('result-' + method);
    expect(resp.type).toBe(MessageType.MEMORY_RPC_RESPONSE);
  });
});

describe('dispatchMemoryRpc · 错误路径', () => {
  it('store 抛错 → ok=false，带 message 与 stack', async () => {
    const store = makeFakeStore();
    const boom = new Error('boom');
    boom.stack = 'Error: boom\n  at x';
    store.remember!.mockRejectedValue(boom);
    const resp = await dispatchMemoryRpc(
      store as unknown as MemoryStore,
      makeRequest('remember', [{ id: 'x', type: 'message', content: 'c', timestamp: 0 }]),
    );
    expect(resp.ok).toBe(false);
    expect(resp.error?.message).toBe('boom');
    expect(resp.error?.stack).toBe('Error: boom\n  at x');
  });

  it('observer 的 onOk / onError 会被调用', async () => {
    const store = makeFakeStore();
    const onOk = vi.fn();
    const onError = vi.fn();
    store.close!.mockResolvedValue(undefined);
    await dispatchMemoryRpc(
      store as unknown as MemoryStore,
      makeRequest('close', []),
      { onOk, onError },
    );
    expect(onOk).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    store.deleteRecord!.mockRejectedValue(new Error('x'));
    await dispatchMemoryRpc(
      store as unknown as MemoryStore,
      makeRequest('deleteRecord', ['id']),
      { onOk, onError },
    );
    expect(onError).toHaveBeenCalled();
  });
});

describe('MEMORY_RPC_METHODS · 契约红线', () => {
  it('仍然是 22 条（与 MemoryStore 契约 1:1）', () => {
    expect(MEMORY_RPC_METHODS.size).toBe(22);
  });
});
