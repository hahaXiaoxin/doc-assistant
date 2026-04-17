/**
 * InsertReferencePlugin · 外部插入 ReferenceNode 的 API 桥
 * ---------------------------------------------
 * 通过 ref 对外暴露 insertReference 方法，供 useSelectionBridge 等外部逻辑调用。
 */
import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection, $insertNodes } from 'lexical';
import { $createReferenceNode, type ReferencePayload } from '../nodes/ReferenceNode';

export interface InsertReferencePluginProps {
  registerInsert: (fn: (payload: ReferencePayload) => void) => void;
}

export function InsertReferencePlugin({ registerInsert }: InsertReferencePluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    registerInsert((payload) => {
      editor.update(() => {
        const selection = $getSelection();
        const node = $createReferenceNode(payload);
        if ($isRangeSelection(selection)) {
          $insertNodes([node]);
        } else {
          // 若无选区（如编辑器从未 focus），直接追加到末尾
          const root = editor.getRootElement();
          root?.focus();
          $insertNodes([node]);
        }
      });
    });
  }, [editor, registerInsert]);

  return null;
}
