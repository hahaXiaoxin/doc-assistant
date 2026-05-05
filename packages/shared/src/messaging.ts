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
   * v0.5.0：MemoryStore 远程 RPC 请求（sidebar/options → offscreen）。
   * envelope 见 {@link MemoryRpcRequest}。
   */
  MEMORY_RPC_REQUEST: 'doc-assistant/memory-rpc-request',
  /**
   * v0.5.0：MemoryStore 远程 RPC 响应（offscreen → sidebar/options）。
   * envelope 见 {@link MemoryRpcResponse}。
   */
  MEMORY_RPC_RESPONSE: 'doc-assistant/memory-rpc-response',
  /**
   * v0.5.0 · PR-2：SW alarm 触发时转发给 offscreen，让 offscreen 内部的
   * `ReflectionScheduler.runPending()` 执行一次。
   *
   * 背景：Offscreen Document 作为 DOM 上下文**不能**监听 `chrome.alarms.onAlarm`
   *（MV3 限制，见 docs/requirements/v0.5.0-unified-memory.md §4 R4）；
   * 因此走"SW 监听 alarm → sendMessage → offscreen 接收"的转发模式。
   *
   * 该消息**只发给 offscreen**（非广播给 sidebar），取代 v0.2.1 的
   * "SW→sidebar 反思 tick 广播"方案（已删除）。
   */
  REFLECTION_TICK: 'doc-assistant/reflection-tick',
  /**
   * v0.5.0 · PR-2：PageVisit 结束即时信号（sidebar → offscreen）。
   *
   * 反思 Job 触发有两条路径：
   * 1. 定时 alarm（见 `REFLECTION_TICK`）
   * 2. 即时触发：PageVisit 结束后立即登记 3 条反思任务并尝试跑一次
   *
   * 原本（v0.2.1）两条都走 sidebar 内的 `ReflectionScheduler.registerOnPageVisitEnd`；
   * v0.5.0 反思 Job 迁到 offscreen，sidebar 只剩信号源，把 visitId 通过此消息
   * 转发到 offscreen，后者内部调 `scheduler.enqueueForVisit(visitId)` + `runPending()`。
   */
  PAGE_VISIT_ENDED: 'doc-assistant/page-visit-ended',
  /**
   * v0.5.0 · hotfix：offscreen → SW 读取 chrome.storage.local 请求。
   *
   * Chrome 官方：**offscreen document 只支持 `chrome.runtime` API**，`chrome.storage`
   * 在 offscreen 下 `undefined` → `createTypedStorage()` 顶层 guard 抛
   * "chrome.storage.local is not available in the current environment."
   * → offscreen bootstrapRuntime 失败 → 所有 MEMORY_RPC_REQUEST 都回 ok=false
   * 带此错误 → sidebar 侧 recordPageVisit / remember 等一律失败。
   *
   * 修复路径：offscreen 不再直接碰 `chrome.storage`，改为向 SW 发此消息；SW 持
   * TypedStorage 读出请求的 keys 后回响应。SW/options/sidebar 仍保留
   * `createTypedStorage()` 直读（它们本身有 storage 权限上下文）。
   */
  OFFSCREEN_STORAGE_READ_REQUEST: 'doc-assistant/offscreen-storage-read-request',
  /** v0.5.0 · hotfix：SW → offscreen 读取响应。 */
  OFFSCREEN_STORAGE_READ_RESPONSE: 'doc-assistant/offscreen-storage-read-response',
  /**
   * v0.6.0 · Debug 导出:其他上下文(sidebar / SW / options)批量 flush 日志
   * entries 给 offscreen 写入本地 IDB。与 MEMORY_RPC_* 分开,避免污染
   * MemoryRpcMethod 白名单。
   */
  LOG_PERSIST_REQUEST: 'doc-assistant/log-persist-request',
  /** v0.6.0 · Debug 导出:offscreen 确认持久化结果。 */
  LOG_PERSIST_RESPONSE: 'doc-assistant/log-persist-response',
  /**
   * v0.6.0 · Debug 导出:请求读取最近 N 条日志(默认 5000)。
   * options 页导出 debug 包时向 offscreen 拉取。
   */
  LOG_EXPORT_REQUEST: 'doc-assistant/log-export-request',
  /** v0.6.0 · Debug 导出:offscreen 返回历史日志数组。 */
  LOG_EXPORT_RESPONSE: 'doc-assistant/log-export-response',
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

/** v0.5.0 · PR-2：SW alarm 触发时转发给 offscreen，让 scheduler 跑 runPending */
export interface ReflectionTickMessage {
  type: typeof MessageType.REFLECTION_TICK;
  /** alarm 触发时刻（毫秒） */
  at: number;
}

/** v0.5.0 · PR-2：sidebar 通知 offscreen "某个 PageVisit 结束了，请登记反思任务" */
export interface PageVisitEndedMessage {
  type: typeof MessageType.PAGE_VISIT_ENDED;
  /** 刚结束的 visit id（offscreen 侧 scheduler.enqueueForVisit 要用） */
  visitId: string;
  /** 结束时刻（毫秒） */
  at: number;
}

/**
 * v0.5.0 · hotfix：offscreen → SW 读取 chrome.storage.local 请求。
 *
 * 设计要点：
 * - SW 端负责鉴权/审计（这里只是读取 storage，没有危险副作用，所以不做强校验）
 * - 一次可带多把 key，SW 端用 TypedStorage 一次性读后以 { key: value } 返回
 * - 仅用于 offscreen bootstrap 阶段；offscreen 之后不会频繁读 storage
 */
export interface OffscreenStorageReadRequest {
  type: typeof MessageType.OFFSCREEN_STORAGE_READ_REQUEST;
  /** 调用侧生成的 uuid，用于匹配响应 */
  rpcId: string;
  /** 要读取的 storage key 列表（对应 STORAGE_KEYS.*） */
  keys: string[];
}

/** v0.5.0 · hotfix：SW → offscreen 读取响应。 */
export interface OffscreenStorageReadResponse {
  type: typeof MessageType.OFFSCREEN_STORAGE_READ_RESPONSE;
  rpcId: string;
  ok: boolean;
  /** ok=true 时返回 {key: value}（value 为 undefined 表示 storage 中没有该 key） */
  values?: Record<string, unknown>;
  /** ok=false 时的错误说明 */
  error?: { message: string };
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

/* ------------------------------------------------------------------ */
/* v0.6.0 · Debug 日志持久化 RPC envelope                                */
/* ---                                                                  */
/* 设计说明:                                                            */
/* - LOG_PERSIST_* 批量 flush:其他上下文每 0.5s 把增量 entries 推给     */
/*   offscreen,offscreen 写入 Dexie `logs` 表;响应只表示 offscreen     */
/*   已接受(不等待 IDB 落盘)                                          */
/* - LOG_EXPORT_*:options 导出 debug 包时一次性拉取最近 5000 条        */
/* - 日志 entry 本身不应含敏感信息(logger 层已约束)                   */
/* ------------------------------------------------------------------ */

export interface LogRpcEntry {
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  module: string;
  msg: string;
  meta?: Record<string, unknown>;
}

export interface LogPersistRequest {
  type: typeof MessageType.LOG_PERSIST_REQUEST;
  /** 调用侧生成的 uuid */
  rpcId: string;
  /** 一批增量 entries(<= 200,避免单次 sendMessage 超限) */
  entries: LogRpcEntry[];
  /** 来源上下文标识,便于排查(例如 "sidebar" / "sw" / "options") */
  origin: string;
}

export interface LogPersistResponse {
  type: typeof MessageType.LOG_PERSIST_RESPONSE;
  rpcId: string;
  ok: boolean;
  accepted?: number;
  error?: { message: string };
}

export interface LogExportRequest {
  type: typeof MessageType.LOG_EXPORT_REQUEST;
  rpcId: string;
  /** 最多返回多少条;默认/上限 5000 */
  limit?: number;
}

export interface LogExportResponse {
  type: typeof MessageType.LOG_EXPORT_RESPONSE;
  rpcId: string;
  ok: boolean;
  entries?: LogRpcEntry[];
  error?: { message: string };
}

export type ExtensionMessage =
  | InsertReferenceMessage
  | ToggleSidebarMessage
  | OpenSidebarMessage
  | OpenOptionsMessage
  | AckMessage
  | ReflectionTickMessage
  | PageVisitEndedMessage
  | OffscreenStorageReadRequest
  | OffscreenStorageReadResponse
  | MemoryRpcRequest
  | MemoryRpcResponse
  | LogPersistRequest
  | LogPersistResponse
  | LogExportRequest
  | LogExportResponse;

/**
 * 同 tab 内 content ↔ sidebar 的 CustomEvent 名
 * （避免依赖 window.postMessage 污染主页面 message 事件流）
 */
export const DOC_ASSISTANT_EVENT = 'doc-assistant:event';
