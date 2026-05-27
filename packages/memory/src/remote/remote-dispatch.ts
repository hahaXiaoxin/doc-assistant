/**
 * RPC dispatcher · 将 MEMORY_RPC_REQUEST 派发到 MemoryStore 实例
 * ---------------------------------------------
 * 使用方：`apps/extension/src/offscreen/index.ts` —— offscreen document 把
 * `chrome.runtime.onMessage` 的 request 转给本函数，拿到 response 回传。
 *
 * 设计要点：
 * - 白名单式派发：只允许 MemoryStore 契约的 22 条方法，未知 method 直接 ok=false
 * - 错误统一序列化为 { message, stack }，调用侧 `RemoteMemoryStore` 会还原成 Error
 * - 纯函数（副作用限于 store 自身）：便于单测 mock 一个假 store 即可
 */
import {
  MessageType,
  compact,
  type MemoryRpcMethod,
  type MemoryRpcRequest,
  type MemoryRpcResponse,
} from '@doc-assistant/shared';
import type { MemoryStore } from '../interface';

/**
 * MemoryStore 方法白名单（与 `MemoryRpcMethod` 1:1）。
 * 运行时收到未列出的 method 会直接回 ok=false。
 */
export const MEMORY_RPC_METHODS: ReadonlySet<MemoryRpcMethod> = new Set<MemoryRpcMethod>([
  'remember',
  'recall',
  'deleteRecord',
  'listVisitSummaries',
  'listSessionTopics',
  'listWorkingMemories',
  'deleteWorkingMemory',
  'getWorkingMemory',
  'setWorkingMemory',
  'touchWorkingMemory',
  'archiveStaleWorkingMemories',
  'listPersonas',
  'addPersonaCandidate',
  'updatePersona',
  'setSessionTopic',
  'getSessionTopic',
  'enqueueReflection',
  'listPendingReflections',
  'updateReflection',
  'recordPageVisit',
  'getPageVisit',
  'close',
]);

type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;

export function isMemoryRpcRequest(msg: unknown): msg is MemoryRpcRequest {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as { type?: unknown };
  return m.type === MessageType.MEMORY_RPC_REQUEST;
}

/** 可选的观测 hook，便于 offscreen 打 `[memory-rpc] method Xms` 日志 */
export interface DispatchObserver {
  onOk?(method: MemoryRpcMethod, elapsedMs: number): void;
  onError?(method: MemoryRpcMethod, elapsedMs: number, err: Error): void;
}

/**
 * 把一条 `MemoryRpcRequest` 派发到 store 对应方法，返回 `MemoryRpcResponse`。
 *
 * 错误处理：
 * - method 不在白名单 / store 上不存在 → ok=false + 明确的 error.message
 * - store 方法抛错 → ok=false + error.message / error.stack 透传
 * - 调用成功 → ok=true + result（调用方需自行保证 result 可跨 runtime 序列化）
 */
export async function dispatchMemoryRpc(
  store: MemoryStore,
  req: MemoryRpcRequest,
  observer?: DispatchObserver,
): Promise<MemoryRpcResponse> {
  const { rpcId, method, args } = req;

  if (!MEMORY_RPC_METHODS.has(method)) {
    return {
      type: MessageType.MEMORY_RPC_RESPONSE,
      rpcId,
      ok: false,
      error: { message: `unknown memory RPC method: ${method}` },
    };
  }

  const fn = (store as unknown as Record<string, unknown>)[method];
  if (typeof fn !== 'function') {
    return {
      type: MessageType.MEMORY_RPC_RESPONSE,
      rpcId,
      ok: false,
      error: { message: `memory store missing method: ${method}` },
    };
  }

  const startedAt = Date.now();
  try {
    const result = await (fn as AnyAsyncFn).apply(store, args ?? []);
    const elapsed = Date.now() - startedAt;
    observer?.onOk?.(method, elapsed);
    return {
      type: MessageType.MEMORY_RPC_RESPONSE,
      rpcId,
      ok: true,
      result,
    };
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    const e = err as Error;
    observer?.onError?.(method, elapsed, e);
    return {
      type: MessageType.MEMORY_RPC_RESPONSE,
      rpcId,
      ok: false,
      error: {
        message: e.message,
        ...compact({ stack: e.stack }),
      },
    };
  }
}
