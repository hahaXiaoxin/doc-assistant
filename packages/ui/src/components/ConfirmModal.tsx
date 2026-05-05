/**
 * ConfirmModal · 通用"确认/取消"弹窗
 * ---------------------------------------------
 * v1.1 PR-4 C3 · 主要给"清空当前会话"场景用,顺便做成通用组件。
 *
 * 无障碍要点:
 * - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` + `aria-describedby`
 * - 打开时把焦点移到初始元素(默认 "取消" —— 更安全,避免连按 Enter 误清)
 * - **Esc** → 取消
 * - **Enter**(在 dialog 内聚焦)→ 按下的是哪个按钮就执行哪个;primary 按钮自身按 Enter
 *   会触发 primary 动作
 * - 关闭 / 取消 / 点外部遮罩 → 视为取消(不触发 onConfirm)
 * - 不做焦点陷阱完整实现(简化版:Tab 在两个按钮之间循环即可,不在 dialog 外逃逸时
 *   项目当前 shadow DOM 结构下用户不大会 Tab 出去)
 *
 * 样式:
 * - 遮罩半透明黑 + 内容卡片浅色底 + 圆角 + 阴影,跟项目整体浅色系协调。
 * - primary 按钮用 `danger` 色(#FF4D4F),强调这是个不可撤销操作。
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${tokens.zIndex.commandMenu};
  background: rgba(0, 0, 0, 0.36);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: fadeIn ${tokens.motion.fast} both;

  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
`;

const Dialog = styled.div`
  width: 100%;
  max-width: 360px;
  background: ${tokens.color.bgWhite};
  border-radius: ${tokens.radius.md};
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.24);
  padding: 20px 20px 16px;
  font-family: ${tokens.font.family};
  color: ${tokens.color.textPrimary};
`;

const Title = styled.div`
  font-size: ${tokens.font.sizeHeading};
  font-weight: 600;
  line-height: 1.4;
  margin-bottom: 6px;
`;

const Body = styled.div`
  font-size: ${tokens.font.sizeBody};
  color: ${tokens.color.textSecondary};
  line-height: 1.6;
  margin-bottom: 18px;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const BaseButton = styled.button`
  all: unset;
  cursor: pointer;
  padding: 6px 16px;
  border-radius: ${tokens.radius.sm};
  font-size: ${tokens.font.sizeBody};
  line-height: 1.4;
  border: 1px solid transparent;
  transition: background ${tokens.motion.fast}, border-color ${tokens.motion.fast},
    color ${tokens.motion.fast};

  &:focus-visible {
    outline: 2px solid ${tokens.color.primary};
    outline-offset: 2px;
  }
`;

const CancelButton = styled(BaseButton)`
  background: ${tokens.color.bgWhite};
  color: ${tokens.color.textPrimary};
  border-color: ${tokens.color.border};

  &:hover {
    border-color: ${tokens.color.borderStrong};
    background: ${tokens.color.bgHoverSubtle};
  }
`;

const DangerButton = styled(BaseButton)`
  background: ${tokens.color.danger};
  color: ${tokens.color.textInverse};
  border-color: ${tokens.color.danger};

  &:hover {
    background: #ff7875;
    border-color: #ff7875;
  }

  &:focus-visible {
    outline-color: ${tokens.color.danger};
  }
`;

export interface ConfirmModalProps {
  /** 是否可见;父组件持有状态 */
  open: boolean;
  title: string;
  /** 文案(短句即可) */
  description: string;
  /** 确认按钮文本(默认 "确认") */
  confirmLabel?: string;
  /** 取消按钮文本(默认 "取消") */
  cancelLabel?: string;
  /** confirm 按钮样式;当前只有 danger;primary 用默认 */
  tone?: 'danger' | 'primary';
  /**
   * 初始聚焦位置:
   * - 'cancel' (默认) —— 更安全,避免连按 Enter 误确认
   * - 'confirm' —— 对于"继续流程"这种高频正向操作更顺手
   */
  initialFocus?: 'cancel' | 'confirm';
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * 指定 Portal 挂载节点;不传时自动用"所在的 shadowRoot 或 document.body"。
   * 扩展 shadow DOM 场景下必须走 shadowRoot,否则 styled-components 注入的 CSS 在
   * 屏幕之外;自动探测通过一个不可见 <span> 的 getRootNode() 完成。
   */
  portalTarget?: Element | ShadowRoot | null;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'primary',
  initialFocus = 'cancel',
  onConfirm,
  onCancel,
  portalTarget,
}: ConfirmModalProps) {
  const titleId = useId();
  const descId = useId();
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * portalTarget 自动探测:用一个不可见的 <span> 作为探针 —— 组件首次 mount 时它
   * 在 React 树里的位置就是宿主期望的位置(比如 shadowRoot 里),读它的 getRootNode()
   * 即可拿到 shadowRoot / document。这样调用方不必把 shadowRoot 一路 prop 传下来。
   */
  const probeRef = useRef<HTMLSpanElement>(null);
  const [autoTarget, setAutoTarget] = useState<Element | ShadowRoot | null>(null);
  useEffect(() => {
    if (portalTarget) return; // 显式传了就不探测
    const node = probeRef.current;
    if (!node) return;
    const root = node.getRootNode();
    if (root instanceof ShadowRoot) {
      setAutoTarget(root);
    } else if (typeof document !== 'undefined') {
      setAutoTarget(document.body);
    }
  }, [portalTarget]);

  // 打开时把焦点移到初始按钮;记录之前的 activeElement 在关闭时还回去
  useEffect(() => {
    if (!open) return;
    const prevActive = (typeof document !== 'undefined'
      ? (document.activeElement as HTMLElement | null)
      : null);
    const target = initialFocus === 'confirm' ? confirmBtnRef.current : cancelBtnRef.current;
    target?.focus();
    return () => {
      prevActive?.focus?.();
    };
  }, [open, initialFocus]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      // Tab 在两按钮间循环(最小版焦点陷阱):
      if (e.key === 'Tab') {
        const focusables = [cancelBtnRef.current, confirmBtnRef.current].filter(
          Boolean,
        ) as HTMLButtonElement[];
        if (focusables.length === 0) return;
        const active = document.activeElement;
        const idx = focusables.findIndex((el) => el === active);
        if (e.shiftKey) {
          if (idx <= 0) {
            e.preventDefault();
            focusables[focusables.length - 1]?.focus();
          }
        } else {
          if (idx === focusables.length - 1) {
            e.preventDefault();
            focusables[0]?.focus();
          }
        }
      }
    },
    [onCancel],
  );

  // 探针始终渲染(显式 style:0 大小),这样 `open=false` 也能在 mount 时拿到 root。
  const probe = (
    <span
      ref={probeRef}
      aria-hidden="true"
      style={{ display: 'none' }}
    />
  );

  if (!open) return probe;

  const ConfirmButton = tone === 'danger' ? DangerButton : BaseButton;
  const target: Element | DocumentFragment | null =
    (portalTarget as Element | DocumentFragment | null | undefined) ??
    (autoTarget as Element | DocumentFragment | null) ??
    (typeof document !== 'undefined' ? document.body : null);

  const dialogNode = (
    <Overlay
      onMouseDown={(e) => {
        // 点击遮罩区域(不是对话框内部)→ 取消
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <Dialog
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Title id={titleId}>{title}</Title>
        <Body id={descId}>{description}</Body>
        <Actions>
          <CancelButton ref={cancelBtnRef} type="button" onClick={onCancel}>
            {cancelLabel}
          </CancelButton>
          <ConfirmButton ref={confirmBtnRef} type="button" onClick={onConfirm}>
            {confirmLabel}
          </ConfirmButton>
        </Actions>
      </Dialog>
    </Overlay>
  );

  return (
    <>
      {probe}
      {target ? createPortal(dialogNode, target) : dialogNode}
    </>
  );
}
