/**
 * Lexical state → 提交给 LLM 的内容拆分
 * ---------------------------------------------
 * 编辑器里混合了：普通文本 + ReferenceNode（tag）。
 * 调用 Agent 时我们需要：
 * - userInput：把所有 ref 替换成 `<ref id="..">text</ref>`，作为用户原话提交
 * - references：把所有 ref 的原文收集起来，作为独立的 reference block（ReferenceTagSource 使用）
 *
 * 这样做让 LLM 既能看到对话流里的引用占位，又能在 system 块里看到引用原文完整信息。
 */
import type { LexicalEditor } from 'lexical';
import { $getRoot, $isTextNode } from 'lexical';
import {
  $isReferenceNode,
  type ReferencePayload,
} from './nodes/ReferenceNode';

export interface SerializedInput {
  /** 用户完整输入文本（引用以 <ref> 标签形式嵌入） */
  userInput: string;
  /** 所有被引用的片段 */
  references: ReferencePayload[];
}

export function serializeEditorState(editor: LexicalEditor): SerializedInput {
  const refs: ReferencePayload[] = [];
  let buffer = '';

  editor.read(() => {
    const root = $getRoot();
    const walk = (node: unknown) => {
      if (!node) return;
      if ($isTextNode(node as never)) {
        buffer += (node as { getTextContent: () => string }).getTextContent();
        return;
      }
      if ($isReferenceNode(node as never)) {
        const ref = node as unknown as import('./nodes/ReferenceNode').ReferenceNode;
        refs.push(ref.getPayload());
        buffer += ref.serialize();
        return;
      }
      const children = (node as { getChildren?: () => unknown[] }).getChildren?.();
      if (children) {
        for (const c of children) walk(c);
        // 段落间换行
        buffer += '\n';
      }
    };
    walk(root);
  });

  return { userInput: buffer.trim(), references: refs };
}

/** 清空编辑器内容 */
export function clearEditor(editor: LexicalEditor): void {
  editor.update(() => {
    $getRoot().clear();
  });
}
