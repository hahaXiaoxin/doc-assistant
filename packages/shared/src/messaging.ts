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

export type ExtensionMessage =
  | InsertReferenceMessage
  | ToggleSidebarMessage
  | OpenSidebarMessage
  | OpenOptionsMessage
  | AckMessage;

/**
 * 同 tab 内 content ↔ sidebar 的 CustomEvent 名
 * （避免依赖 window.postMessage 污染主页面 message 事件流）
 */
export const DOC_ASSISTANT_EVENT = 'doc-assistant:event';
