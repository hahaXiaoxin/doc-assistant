/**
 * useSelectionBridge · 接收 content script 发来的划词引用事件
 * ---------------------------------------------
 * content script 通过 CustomEvent 'doc-assistant:insert-reference' 把用户点击"引用"后的选区传进来。
 * 本 hook 监听并调用 LexicalChatInput 暴露的 insertReference 方法，把 ReferenceNode 插入到输入框。
 */
import { useEffect } from 'react';
import type { ReferencePayload } from '../editor/nodes/ReferenceNode';

const EVENT = 'doc-assistant:insert-reference';

export function useSelectionBridge(
  insertReference: ((payload: ReferencePayload) => void) | null,
): void {
  useEffect(() => {
    if (!insertReference) return;
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<ReferencePayload>).detail;
      if (!detail) return;
      insertReference(detail);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [insertReference]);
}

/** content script 侧使用：向 sidebar 派发引用事件 */
export function dispatchInsertReference(payload: ReferencePayload): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: payload }));
}

export const INSERT_REFERENCE_EVENT = EVENT;
