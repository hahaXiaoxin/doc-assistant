/**
 * useSelectionBridge · 接收 content script 发来的划词引用事件
 * ---------------------------------------------
 * content script 通过 CustomEvent 'doc-assistant:insert-reference' 把用户点击"引用"后的选区传进来。
 * 本 hook 监听并调用 LexicalChatInput 暴露的 insertReference 方法，把 ReferenceNode 插入到输入框。
 *
 * 注意：insertReference 的实现由 InsertReferencePlugin 在挂载后异步注入 ref，
 * 为避免 hook 闭包固化到"空函数"的旧引用，这里改为接受一个 getter，每次事件触发时实时取最新值。
 */
import { useEffect } from 'react';
import type { ReferencePayload } from '../editor/nodes/ReferenceNode';

const EVENT = 'doc-assistant:insert-reference';

export function useSelectionBridge(
  getInsertReference: () => ((payload: ReferencePayload) => void) | null,
): void {
  useEffect(() => {
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<ReferencePayload>).detail;
      if (!detail) return;
      const fn = getInsertReference();
      if (!fn) {
        // 编辑器尚未挂载完成；忽略一次事件（理论上极少发生）
        return;
      }
      fn(detail);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, [getInsertReference]);
}

/** content script 侧使用：向 sidebar 派发引用事件 */
export function dispatchInsertReference(payload: ReferencePayload): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: payload }));
}

export const INSERT_REFERENCE_EVENT = EVENT;
