/**
 * StatusStrip · 通用"状态条"组件
 * ---------------------------------------------
 * v1.1 PR-3 C1 · 把 WorkingMemoryCard / PersonaReviewBanner 的视觉语言统一到这里。
 *
 * 结构：
 *   [3px 竖条 accent] [icon 16px] [label] [meta,省略号] [action?]
 *
 * 行高 32-36px；单行省略;支持展开态 body(通过 children)。
 *
 * 为什么不直接复用 CollapsiblePanel / Antd Alert:
 * - 这里的核心是"侧边栏上方的薄一行状态指示",需要左侧 accent 条 + 极致紧凑，
 *   Antd 的 Alert / Tag 都过粗。
 * - CollapsiblePanel 是吸附式容器,和这里的条形状态是不同物种。
 *
 * 键盘/a11y:
 * - Header 是 button,原生 focus + Enter/Space 切换展开;
 * - 超长 meta 由 CSS 单行省略,title 属性兜底 hover tooltip;
 * - ariaLabel 指定整个条的语义。
 */
import { type ReactNode } from 'react';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';

export interface StatusStripProps {
  /** 左侧 3px 竖条颜色 */
  accentColor: string;
  /** 16px icon(传 emoji / SVG / 任意 ReactNode) */
  icon?: ReactNode;
  /** 主文案(不省略,会推挤 meta) */
  label: ReactNode;
  /** 次文案(省略号,hover tooltip) */
  meta?: string;
  /** 右侧 action(chevron / 按钮等) */
  action?: ReactNode;
  /** 受控展开态 */
  expanded?: boolean;
  /** 点击顶部条时的回调(默认切换 expanded) */
  onToggle?: () => void;
  /** 展开态 body */
  children?: ReactNode;
  /** 整条的 aria-label */
  ariaLabel?: string;
}

const Wrap = styled.div<{ $accent: string }>`
  margin: 8px 12px 0;
  background: ${tokens.color.bgSoft};
  border: 1px solid ${tokens.color.border};
  border-left: 3px solid ${(p) => p.$accent};
  border-radius: ${tokens.radius.sm};
  font-size: ${tokens.font.sizeSmall};
  color: ${tokens.color.textSecondary};
  flex-shrink: 0;
  overflow: hidden;
`;

const HeaderRow = styled.button`
  all: unset;
  box-sizing: border-box;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 4px 10px;
  color: ${tokens.color.textPrimary};

  &:focus-visible {
    outline: 2px solid ${tokens.color.primary};
    outline-offset: -2px;
  }

  &:hover {
    background: ${tokens.color.bgHoverSubtle};
  }
`;

const IconSlot = styled.span`
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
`;

const Label = styled.span`
  flex-shrink: 0;
  font-weight: 500;
  font-size: ${tokens.font.sizeSmall};
`;

const Meta = styled.span`
  flex: 1;
  min-width: 0;
  color: ${tokens.color.textTertiary};
  font-size: ${tokens.font.sizeSmall};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ActionSlot = styled.span`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: ${tokens.color.textTertiary};
`;

const Body = styled.div`
  padding: 0 10px 10px;
  background: ${tokens.color.bgSoft};
`;

export function StatusStrip({
  accentColor,
  icon,
  label,
  meta,
  action,
  expanded,
  onToggle,
  children,
  ariaLabel,
}: StatusStripProps): JSX.Element {
  const hasBody = children !== undefined && children !== null && children !== false;
  return (
    <Wrap $accent={accentColor} aria-label={ariaLabel}>
      <HeaderRow
        type="button"
        onClick={onToggle}
        aria-expanded={hasBody ? !!expanded : undefined}
      >
        {icon !== undefined && <IconSlot aria-hidden>{icon}</IconSlot>}
        <Label>{label}</Label>
        {meta !== undefined && (
          <Meta title={meta}>{meta}</Meta>
        )}
        {meta === undefined && <span style={{ flex: 1 }} />}
        {action !== undefined && <ActionSlot>{action}</ActionSlot>}
      </HeaderRow>
      {hasBody && expanded && <Body>{children}</Body>}
    </Wrap>
  );
}

/** 通用 chevron(供接入方复用;旋转 90° 表示展开) */
export const StatusStripChevron = styled.span<{ $open: boolean }>`
  display: inline-block;
  transition: transform ${tokens.motion.fast};
  transform: rotate(${(p) => (p.$open ? 90 : 0)}deg);
  color: ${tokens.color.textTertiary};
  font-size: 14px;
  line-height: 1;
`;
