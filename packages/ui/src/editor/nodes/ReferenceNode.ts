/**
 * ReferenceNode · Lexical 自定义 DecoratorNode
 * ---------------------------------------------
 * 承载"用户划词后插入的引用 tag"。
 * - 数据：{ id, text, source: { url, title?, selector? } }
 * - 展示：交给外部注入的 renderer，UI 层渲染为 chip 样式
 * - 序列化：发送给 LLM 时通过 serialize() 得到 `<ref id="...">text</ref>`
 */
import {
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import type { JSX } from 'react';

export interface ReferenceSource {
  url: string;
  title?: string;
  selector?: string;
}

export interface ReferencePayload {
  id: string;
  text: string;
  source: ReferenceSource;
}

export type SerializedReferenceNode = Spread<
  {
    payload: ReferencePayload;
  },
  SerializedLexicalNode
>;

/** 外部注入的 React 渲染器（允许不同主题自定义 tag 外观） */
export type ReferenceRenderer = (payload: ReferencePayload) => JSX.Element;

let rendererRef: ReferenceRenderer | null = null;
export function setReferenceRenderer(renderer: ReferenceRenderer): void {
  rendererRef = renderer;
}

export class ReferenceNode extends DecoratorNode<JSX.Element> {
  __payload: ReferencePayload;

  static override getType(): string {
    return 'doc-assistant-reference';
  }

  static override clone(node: ReferenceNode): ReferenceNode {
    return new ReferenceNode(node.__payload, node.__key);
  }

  constructor(payload: ReferencePayload, key?: NodeKey) {
    super(key);
    this.__payload = payload;
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    // DecoratorNode 实际渲染由 decorate() 返回的 React 节点负责；此处只需容器
    const span = document.createElement('span');
    span.setAttribute('data-doc-assistant-ref', this.__payload.id);
    return span;
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): JSX.Element {
    if (!rendererRef) {
      throw new Error('[ReferenceNode] renderer 未注册；请在应用启动时调用 setReferenceRenderer');
    }
    return rendererRef(this.__payload);
  }

  override isInline(): boolean {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return true;
  }

  override exportJSON(): SerializedReferenceNode {
    return {
      type: ReferenceNode.getType(),
      payload: this.__payload,
      version: 1,
    };
  }

  static override importJSON(json: SerializedReferenceNode): ReferenceNode {
    return new ReferenceNode(json.payload);
  }

  getPayload(): ReferencePayload {
    return this.__payload;
  }

  /** 序列化为发送给 LLM 的 `<ref>` 标签 */
  serialize(): string {
    const escaped = this.__payload.text.replace(/[<>&]/g, (c) =>
      c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;',
    );
    return `<ref id="${this.__payload.id}" url="${this.__payload.source.url}">${escaped}</ref>`;
  }
}

export function $createReferenceNode(payload: ReferencePayload): ReferenceNode {
  return new ReferenceNode(payload);
}

export function $isReferenceNode(node: LexicalNode | null | undefined): node is ReferenceNode {
  return node instanceof ReferenceNode;
}
