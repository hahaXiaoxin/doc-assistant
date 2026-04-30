/**
 * 扩展内消息协议定义
 * ---------------------------------------------
 * 管道总览：
 * - content script ↔ sidebar（同一 tab 内，通过 CustomEvent / postMessage）
 * - content script ↔ background（chrome.runtime.sendMessage）
 * - options page ↔ background（chrome.runtime.sendMessage）
 *
 * 所有跨上下文消息必须带 `type` 字段，走本文件的类型定义，避免散落的字符串常量。
 */

/** 扩展内部消息类型枚举 */
export const MessageType = {
  /** content → sidebar：用户划词后请求插入引用 */
  INSERT_REFERENCE: 'doc-assistant/insert-reference',
  /** content → background / sidebar：切换侧边栏可见性 */
  TOGGLE_SIDEBAR: 'doc-assistant/toggle-sidebar',
  /** background / any → content：打开侧边栏 */
  OPEN_SIDEBAR: 'doc-assistant/open-sidebar',
  /** options / any → background：请求打开配置页 */
  OPEN_OPTIONS: 'doc-assistant/open-options',
  /** 通用 ACK */
  ACK: 'doc-assistant/ack',
  /**
   * v0.2.1：SW alarm 触发时广播给 sidebar，让在线的 sidebar 调用
   * `ReflectionScheduler.runPending()`。
   * 若没有 sidebar 在线，此消息被浏览器丢弃；下次 sidebar 打开时 bootstrap
   * 会主动补跑一次。
   *
   * v0.5.0：此绕路即将在 PR-2 中删除（反思 Job 迁移到 offscreen 直接跑）。
   * PR-1 保留枚举项不动，避免编译报错。
   */
  REFLECTION_SCAN_TICK: 'doc-assistant/reflection-scan-tick',
  /**
   * v0.5.0：MemoryStore 远程 RPC 请求（sidebar/options → offscreen）。
   * envelope 见 {@link MemoryRpcRequest}。
   */
  MEMORY_RPC_REQUEST: 'doc-assistant/memory-rpc-request',
  /**
   * v0.5.0：MemoryStore 远程 RPC 响应（offscreen → sidebar/options）。
   * envelope 见 {@link MemoryRpcResponse}。
   */
  MEMORY_RPC_RESPONSE: 'doc-assistant/memory-rpc-response',
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/** 划词引用载荷 */
export interface InsertReferencePayload {
  id: string;
  text: string;
  source: {
    url: string;
    title?: string;
    /** CSS-like 选择器或选区的简化描述，供后续精准定位 */
    selector?: string;
  };
}

export interface InsertReferenceMessage {
  type: typeof MessageType.INSERT_REFERENCE;
  payload: InsertReferencePayload;
}

export interface ToggleSidebarMessage {
  type: typeof MessageType.TOGGLE_SIDEBAR;
}

export interface OpenSidebarMessage {
  type: typeof MessageType.OPEN_SIDEBAR;
}

export interface OpenOptionsMessage {
  type: typeof MessageType.OPEN_OPTIONS;
}

export interface AckMessage {
  type: typeof MessageType.ACK;
  ok: boolean;
  error?: string;
}

/** v0.2.1：反思任务扫描 tick（SW alarm → sidebar） */
export interface ReflectionScanTickMessage {
  type: typeof MessageType.REFLECTION_SCAN_TICK;
  /** alarm 触发时刻（毫秒） */
  at: number;
}

/* ------------------------------------------------------------------ */
/* v0.5.0 · MemoryStore 远程 RPC envelope                               */
/* ---                                                                  */
/* sidebar/options 用 RemoteMemoryStore 通过 chrome.runtime.sendMessage  */
/* 把 MemoryStore 方法调用转发到 offscreen document 统一处理。           */
/* 协议要点：                                                            */
/* - rpcId 调用侧生成 uuid，用于 response 匹配                           */
/* - method / args 与 MemoryStore 方法签名 1:1                           */
/* - 错误统一序列化为 { message, stack } 字符串对                        */
/* - Float32Array 不跨 RPC（embedding 由 offscreen 内部重算；见文档§1.4）*/
/* ------------------------------------------------------------------ */

/** RemoteMemoryStore 支持的 method 枚举（与 MemoryStore 接口 22 条契约 1:1） */
export type MemoryRpcMethod =
  | 'remember'
  | 'recall'
  | 'deleteRecord'
  | 'listVisitSummaries'
  | 'listSessionTopics'
  | 'listWorkingMemories'
  | 'deleteWorkingMemory'
  | 'getWorkingMemory'
  | 'setWorkingMemory'
  | 'touchWorkingMemory'
  | 'archiveStaleWorkingMemories'
  | 'listPersonas'
  | 'addPersonaCandidate'
  | 'updatePersona'
  | 'setSessionTopic'
  | 'getSessionTopic'
  | 'enqueueReflection'
  | 'listPendingReflections'
  | 'updateReflection'
  | 'recordPageVisit'
  | 'getPageVisit'
  | 'close';

export interface MemoryRpcRequest {
  type: typeof MessageType.MEMORY_RPC_REQUEST;
  /** 调用侧生成的 uuid，用于匹配响应 */
  rpcId: string;
  method: MemoryRpcMethod;
  /** 位置参数，与 MemoryStore 方法签名一致 */
  args: unknown[];
}

export interface MemoryRpcErrorPayload {
  message: string;
  stack?: string;
}

export interface MemoryRpcResponse {
  type: typeof MessageType.MEMORY_RPC_RESPONSE;
  rpcId: string;
  ok: boolean;
  /** ok=true 时返回的方法结果（已序列化后的 JSON 友好值） */
  result?: unknown;
  /** ok=false 时的错误载荷 */
  error?: MemoryRpcErrorPayload;
}

export type ExtensionMessage =
  | InsertReferenceMessage
  | ToggleSidebarMessage
  | OpenSidebarMessage
  | OpenOptionsMessage
  | AckMessage
  | ReflectionScanTickMessage
  | MemoryRpcRequest
  | MemoryRpcResponse;

/**
 * 同 tab 内 content ↔ sidebar 的 CustomEvent 名
 * （避免依赖 window.postMessage 污染主页面 message 事件流）
 */
export const DOC_ASSISTANT_EVENT = 'doc-assistant:event';
