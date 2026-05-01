/**
 * 单测：offscreen reflection-bridge
 * ---------------------------------------------
 * 覆盖：
 * - REFLECTION_TICK 消息命中 → scheduler.runPending() 被调用
 * - PAGE_VISIT_ENDED 消息命中 → scheduler.enqueueForVisit(visitId) + runPending()
 * - scheduler 为 null（反思关闭）时不抛错
 * - 非目标消息类型被忽略（listener 返回 false 不拦截）
 *
 * 这些用例覆盖文档 §1.4 第 24/25 条消息协议的派发正确性，不依赖真实
 * chrome.runtime / IDB。
 */
import { describe, it, expect, vi } from 'vitest';
import { MessageType } from '@doc-assistant/shared';
import type { ReflectionScheduler } from '@doc-assistant/agent';
import {
  installReflectionBridge,
  type RuntimeMessageBus,
} from '../reflection-bridge';

type Listener = Parameters<RuntimeMessageBus['onMessage']['addListener']>[0];

/** 捕获 installReflectionBridge 挂上去的 listener，方便手动触发消息 */
function makeBus(): { bus: RuntimeMessageBus; trigger: (msg: unknown) => void } {
  const listeners: Listener[] = [];
  const bus: RuntimeMessageBus = {
    onMessage: {
      addListener(l) {
        listeners.push(l);
      },
    },
  };
  function trigger(msg: unknown): void {
    for (const l of listeners) {
      l(msg, {} as chrome.runtime.MessageSender, () => {
        /* noop */
      });
    }
  }
  return { bus, trigger };
}

function makeFakeScheduler() {
  return {
    runPending: vi.fn().mockResolvedValue({ total: 0, succeeded: 0, failed: 0, skipped: 0 }),
    enqueueForVisit: vi.fn().mockResolvedValue([]),
  } as unknown as ReflectionScheduler & {
    runPending: ReturnType<typeof vi.fn>;
    enqueueForVisit: ReturnType<typeof vi.fn>;
  };
}

/** 让 listener 的 fire-and-forget async 任务排到下一个 microtask */
async function flush(): Promise<void> {
  // 两轮 microtask：listener 内部 await getScheduler() + await scheduler.runPending()
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('offscreen · reflection-bridge', () => {
  it('REFLECTION_TICK 触发 scheduler.runPending()', async () => {
    const { bus, trigger } = makeBus();
    const scheduler = makeFakeScheduler();
    const onTick = vi.fn();

    installReflectionBridge(bus, {
      getScheduler: async () => scheduler,
      onTick,
    });

    trigger({ type: MessageType.REFLECTION_TICK, at: 1700000000000 });
    await flush();

    expect(onTick).toHaveBeenCalledWith('alarm');
    expect(scheduler.runPending).toHaveBeenCalledTimes(1);
    expect(scheduler.enqueueForVisit).not.toHaveBeenCalled();
  });

  it('PAGE_VISIT_ENDED 触发 enqueueForVisit(visitId) + runPending()', async () => {
    const { bus, trigger } = makeBus();
    const scheduler = makeFakeScheduler();
    const onTick = vi.fn();

    installReflectionBridge(bus, {
      getScheduler: async () => scheduler,
      onTick,
    });

    trigger({
      type: MessageType.PAGE_VISIT_ENDED,
      visitId: 'visit-abc',
      at: 1700000001000,
    });
    await flush();

    expect(onTick).toHaveBeenCalledWith('page_visit_ended', 'visit-abc');
    expect(scheduler.enqueueForVisit).toHaveBeenCalledWith('visit-abc');
    expect(scheduler.runPending).toHaveBeenCalledTimes(1);
  });

  it('scheduler 为 null 时两类消息都不抛错', async () => {
    const { bus, trigger } = makeBus();

    installReflectionBridge(bus, {
      getScheduler: async () => null,
    });

    trigger({ type: MessageType.REFLECTION_TICK, at: 0 });
    trigger({
      type: MessageType.PAGE_VISIT_ENDED,
      visitId: 'v1',
      at: 0,
    });
    await flush();
    // 没有断言也 ok——只要不抛 unhandled rejection 就过
  });

  it('非目标消息被忽略（不触发 scheduler）', async () => {
    const { bus, trigger } = makeBus();
    const scheduler = makeFakeScheduler();

    installReflectionBridge(bus, {
      getScheduler: async () => scheduler,
    });

    trigger({ type: MessageType.TOGGLE_SIDEBAR });
    trigger({ type: MessageType.MEMORY_RPC_REQUEST, rpcId: '1', method: 'recall', args: [{}] });
    trigger(null);
    trigger('string-msg');
    await flush();

    expect(scheduler.runPending).not.toHaveBeenCalled();
    expect(scheduler.enqueueForVisit).not.toHaveBeenCalled();
  });

  it('scheduler 抛错时 listener 不抛出到外层（只打日志）', async () => {
    const { bus, trigger } = makeBus();
    const scheduler = {
      runPending: vi.fn().mockRejectedValue(new Error('boom')),
      enqueueForVisit: vi.fn().mockResolvedValue([]),
    } as unknown as ReflectionScheduler;

    installReflectionBridge(bus, {
      getScheduler: async () => scheduler,
    });

    // 不要把这些 reject 变成测试失败
    trigger({ type: MessageType.REFLECTION_TICK, at: 1 });
    await flush();
    // 到这里没炸就算过
    expect(
      (scheduler as unknown as { runPending: ReturnType<typeof vi.fn> }).runPending,
    ).toHaveBeenCalled();
  });
});
