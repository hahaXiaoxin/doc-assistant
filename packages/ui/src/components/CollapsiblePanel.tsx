/**
 * CollapsiblePanel · 可折叠的右侧吸附面板
 * ---------------------------------------------
 * 展开态：默认宽 420px，右侧吸附；可拖拽左边缘调节宽度（360~640px）。
 * 折叠态：44x44 的圆形图标吸附在右边缘中间。
 *
 * 宽度通过 localStorage 持久化（key: doc-assistant.sidebar-width）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import styled, { keyframes } from 'styled-components';
import { tokens } from '../theme/tokens';
import { IconMessageCircle } from './icons';

const WIDTH_KEY = 'doc-assistant.sidebar-width';
const MIN_W = 360;
const MAX_W = 640;
const DEFAULT_W = 420;

const slideIn = keyframes`
  from { transform: translateX(24px); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
`;

const Panel = styled.aside<{ $width: number }>`
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: ${(p) => p.$width}px;
  max-width: 90vw;
  background: ${tokens.color.bgPanel};
  backdrop-filter: saturate(180%) blur(18px);
  -webkit-backdrop-filter: saturate(180%) blur(18px);
  box-shadow: ${tokens.shadow.panel};
  border-left: 1px solid ${tokens.color.border};
  display: flex;
  flex-direction: column;
  font-family: ${tokens.font.family};
  color: ${tokens.color.textPrimary};
  animation: ${slideIn} ${tokens.motion.normal};
  z-index: ${tokens.zIndex.sidebar};
  pointer-events: auto; /* host 设了 none，这里显式恢复 */
`;

const Drag = styled.div`
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
  z-index: 1;

  &:hover::after {
    content: '';
    position: absolute;
    left: 2px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: rgba(22, 119, 255, 0.2);
    border-radius: 2px;
  }
`;

const CollapsedFab = styled.button`
  all: unset;
  position: fixed;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  border-radius: ${tokens.radius.pill} 0 0 ${tokens.radius.pill};
  background: ${tokens.color.bgFab};
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  box-shadow: -4px 0 12px rgba(0, 0, 0, 0.08);
  border: 1px solid ${tokens.color.border};
  border-right: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: ${tokens.color.primary};
  font-size: 20px;
  z-index: ${tokens.zIndex.sidebar};
  transition: all ${tokens.motion.fast};
  pointer-events: auto; /* host 设了 none，这里显式恢复 */

  &:hover {
    background: ${tokens.color.bgWhite};
    box-shadow: -6px 0 16px rgba(0, 0, 0, 0.12);
  }
`;

export interface CollapsiblePanelProps {
  visible: boolean;
  onRequestOpen: () => void;
  children: ReactNode;
}

export function CollapsiblePanel({ visible, onRequestOpen, children }: CollapsiblePanelProps) {
  const [width, setWidth] = useState<number>(() => {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    return raw >= MIN_W && raw <= MAX_W ? raw : DEFAULT_W;
  });
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = startXRef.current - e.clientX; // 拖拽向左增加宽度
      const next = Math.max(MIN_W, Math.min(MAX_W, startWRef.current + dx));
      setWidth(next);
    };
    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        localStorage.setItem(WIDTH_KEY, String(width));
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [width]);

  if (!visible) {
    return (
      <CollapsedFab title="打开 Doc Assistant" onClick={onRequestOpen} aria-label="打开 Doc Assistant">
        <IconMessageCircle size={20} />
      </CollapsedFab>
    );
  }

  return (
    <Panel $width={width} aria-hidden={!visible}>
      <Drag
        onMouseDown={(e) => {
          draggingRef.current = true;
          startXRef.current = e.clientX;
          startWRef.current = width;
        }}
      />
      {children}
    </Panel>
  );
}
