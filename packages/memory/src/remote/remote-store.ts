/**
 * RemoteMemoryStore · MemoryStore 的远程代理实现（v0.5.0）
 * ---------------------------------------------
 * 目标：让 sidebar（content-script origin）/ options 页（扩展 origin）看到
 *       同一份 IndexedDB —— 所有 MemoryStore 方法一律通过
 *       `chrome.runtime.sendMessage` 转发到 offscreen document 执行。
 *
 * 设计要点：
 * - 本类不持 Dexie、不做 embedding 计算；所有业务逻辑都在 offscreen 内部
 * - 对 22 条 MemoryStore 方法 1:1 转发（见 docs/requirements/v0.5.0-unified-memory.md §1.4）
 * - 序列化边界：
 *   * Float32Array 不跨 RPC：`remember()` 传入的 `embedding` 会被剥离，
 *     offscreen 端按需重算并写入（见文档§1.4 "本期选择后者"）
 *   * Error 统一走 { message, stack } 结构
 * - 超时：默认 15s（`remember` 含 embedding 可能较慢，15s 足够），超时抛
 *   `MemoryRpcTimeoutError`
 * - 构造不接受 embedQuery 参数（callback 无法序列化；embedding 由 offscreen 持有）
 *
 * 契约红线：`MemoryStore` 接口不改；本类只是消息代理。
 */
import {
  MessageType,
  type MemoryRpcMethod,
  type MemoryRpcRequest,
  type MemoryRpcResponse,
} from '@doc-assistant/shared';
import type {
  MemoryRecord,
  MemoryStore,
  RecallQuery,
  PersonaRecord,
  PersonaStatus,
  PersonaSubject,
  SessionTopicRecord,
  WorkingMemoryRecord,
  ReflectionTask,
  ReflectionStatus,
  PageVisitRecord,
} from '../interface';

/** 默认 RPC 超时（15s，足以覆盖 embedding 生成 + IDB 写入） */
export const DEFAULT_MEMORY_RPC_TIMEOUT_MS = 15_000;

/** RPC 超时错误 */
export class MemoryRpcTimeoutError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(`MemoryRpcTimeoutError: ${method} exceeded ${timeoutMs}ms`);
    this.name = 'MemoryRpcTimeoutError';
  }
}

/**
 * RPC 传输层抽象 · 便于单测 mock。
 * 默认实现走 `chrome.runtime.sendMessage`。
 */
export interface RpcTransport {
  send(req: MemoryRpcRequest): Promise<MemoryRpcResponse>;
}

/** 默认 transport：封装 chrome.runtime.sendMessage → Promise<MemoryRpcResponse> */
export function defaultChromeRuntimeTransport(): RpcTransport {
  // 避免让 @doc-assistant/memory 依赖 @types/chrome——此处用结构化类型访问
  interface RuntimeLike {
    sendMessage?: (msg: unknown) => Promise<unknown>;
  }
  interface ChromeLike {
    runtime?: RuntimeLike;
  }
  const chromeGlobal = (globalThis as unknown as { chrome?: ChromeLike }).chrome;

  return {
    async send(req: MemoryRpcRequest): Promise<MemoryRpcResponse> {
      const sendMessage = chromeGlobal?.runtime?.sendMessage;
      if (!sendMessage) {
        throw new Error('chrome.runtime.sendMessage is not available');
      }
      const resp = (await sendMessage.call(chromeGlobal?.runtime, req)) as
        | MemoryRpcResponse
        | undefined;
      if (!resp || resp.type !== MessageType.MEMORY_RPC_RESPONSE) {
        throw new Error(
          `RemoteMemoryStore: unexpected RPC response shape (rpcId=${req.rpcId}, method=${req.method})`,
        );
      }
      return resp;
    },
  };
}

export interface RemoteMemoryStoreOptions {
  /** RPC 超时（毫秒），默认 {@link DEFAULT_MEMORY_RPC_TIMEOUT_MS} */
  timeoutMs?: number;
  /** 自定义 transport（单测用） */
  transport?: RpcTransport;
  /** 自定义 rpcId 生成（单测用） */
  genRpcId?: () => string;
}

/** 生成简单的递增 uuid（不依赖 crypto.randomUUID，避免 jsdom/happy-dom 兼容问题） */
function makeDefaultRpcIdFactory(): () => string {
  let counter = 0;
  const base =
    typeof Date !== 'undefined' ? Date.now().toString(36) : Math.random().toString(36).slice(2);
  return () => {
    counter += 1;
    return `mem-rpc-${base}-${counter}`;
  };
}

/**
 * 去除 MemoryRecord 上不能跨 RPC 序列化的字段（Float32Array embedding）。
 * offscreen 端会根据 content 按需重算 embedding 后写入。
 */
function stripEmbedding(record: MemoryRecord): MemoryRecord {
  if (!record.embedding) return record;
  const { embedding: _discarded, ...rest } = record;
  return rest as MemoryRecord;
}

export class RemoteMemoryStore implements MemoryStore {
  private readonly transport: RpcTransport;
  private readonly timeoutMs: number;
  private readonly genRpcId: () => string;

  constructor(opts: RemoteMemoryStoreOptions = {}) {
    this.transport = opts.transport ?? defaultChromeRuntimeTransport();
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_MEMORY_RPC_TIMEOUT_MS;
    this.genRpcId = opts.genRpcId ?? makeDefaultRpcIdFactory();
  }

  /** 内部统一调用入口：组 envelope、超时、错误还原 */
  private async invoke<T>(method: MemoryRpcMethod, args: unknown[]): Promise<T> {
    const rpcId = this.genRpcId();
    const req: MemoryRpcRequest = {
      type: MessageType.MEMORY_RPC_REQUEST,
      rpcId,
      method,
      args,
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new MemoryRpcTimeoutError(method, this.timeoutMs));
      }, this.timeoutMs);
    });

    try {
      const resp = await Promise.race([this.transport.send(req), timeoutPromise]);
      if (resp.rpcId !== rpcId) {
        throw new Error(
          `RemoteMemoryStore: rpcId mismatch (expected ${rpcId}, got ${resp.rpcId})`,
        );
      }
      if (!resp.ok) {
        const err = new Error(resp.error?.message ?? `RPC error: ${method}`);
        if (resp.error?.stack) {
          err.stack = resp.error.stack;
        }
        throw err;
      }
      return resp.result as T;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /* --- 22 条 MemoryStore 方法 RPC 透传 --- */

  async remember(record: MemoryRecord): Promise<void> {
    // 剥离 Float32Array embedding：不跨 RPC 序列化，offscreen 按需重算
    return this.invoke<void>('remember', [stripEmbedding(record)]);
  }

  async recall(query: RecallQuery): Promise<MemoryRecord[]> {
    return this.invoke<MemoryRecord[]>('recall', [query]);
  }

  async deleteRecord(id: string): Promise<void> {
    return this.invoke<void>('deleteRecord', [id]);
  }

  async listVisitSummaries(opts?: {
    timeRange?: [number, number];
    limit?: number;
  }): Promise<MemoryRecord[]> {
    return this.invoke<MemoryRecord[]>('listVisitSummaries', [opts]);
  }

  async listSessionTopics(opts?: { limit?: number }): Promise<SessionTopicRecord[]> {
    return this.invoke<SessionTopicRecord[]>('listSessionTopics', [opts]);
  }

  async listWorkingMemories(opts?: { limit?: number }): Promise<WorkingMemoryRecord[]> {
    return this.invoke<WorkingMemoryRecord[]>('listWorkingMemories', [opts]);
  }

  async deleteWorkingMemory(canonicalUrl: string): Promise<void> {
    return this.invoke<void>('deleteWorkingMemory', [canonicalUrl]);
  }

  async getWorkingMemory(canonicalUrl: string): Promise<WorkingMemoryRecord | null> {
    return this.invoke<WorkingMemoryRecord | null>('getWorkingMemory', [canonicalUrl]);
  }

  async setWorkingMemory(record: WorkingMemoryRecord): Promise<void> {
    return this.invoke<void>('setWorkingMemory', [record]);
  }

  async touchWorkingMemory(canonicalUrl: string, at?: number): Promise<void> {
    return this.invoke<void>('touchWorkingMemory', [canonicalUrl, at]);
  }

  async archiveStaleWorkingMemories(ttlMs: number): Promise<number> {
    return this.invoke<number>('archiveStaleWorkingMemories', [ttlMs]);
  }

  async listPersonas(opts?: {
    status?: PersonaStatus;
    subject?: PersonaSubject;
  }): Promise<PersonaRecord[]> {
    return this.invoke<PersonaRecord[]>('listPersonas', [opts]);
  }

  async addPersonaCandidate(
    candidate: Omit<PersonaRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PersonaRecord> {
    return this.invoke<PersonaRecord>('addPersonaCandidate', [candidate]);
  }

  async updatePersona(
    id: string,
    patch: Partial<PersonaRecord>,
    reason?: string,
  ): Promise<void> {
    return this.invoke<void>('updatePersona', [id, patch, reason]);
  }

  async setSessionTopic(record: SessionTopicRecord): Promise<void> {
    return this.invoke<void>('setSessionTopic', [record]);
  }

  async getSessionTopic(visitId: string): Promise<SessionTopicRecord | null> {
    return this.invoke<SessionTopicRecord | null>('getSessionTopic', [visitId]);
  }

  async enqueueReflection(
    task: Omit<ReflectionTask, 'id' | 'createdAt' | 'attemptsCount' | 'status'> & {
      id?: string;
      status?: ReflectionStatus;
    },
  ): Promise<ReflectionTask> {
    return this.invoke<ReflectionTask>('enqueueReflection', [task]);
  }

  async listPendingReflections(maxAttempts?: number): Promise<ReflectionTask[]> {
    return this.invoke<ReflectionTask[]>('listPendingReflections', [maxAttempts]);
  }

  async updateReflection(
    id: string,
    patch: Partial<
      Pick<ReflectionTask, 'status' | 'attemptsCount' | 'completedAt' | 'lastError'>
    >,
  ): Promise<void> {
    return this.invoke<void>('updateReflection', [id, patch]);
  }

  async recordPageVisit(visit: PageVisitRecord): Promise<void> {
    return this.invoke<void>('recordPageVisit', [visit]);
  }

  async getPageVisit(visitId: string): Promise<PageVisitRecord | null> {
    return this.invoke<PageVisitRecord | null>('getPageVisit', [visitId]);
  }

  async close(): Promise<void> {
    // offscreen 端 no-op（lifecycle 由 SW 统管）；这里只是走一轮 RPC 以保语义一致
    return this.invoke<void>('close', []);
  }
}
