/**
 * CommandMenu · 斜杠命令候选下拉
 * ---------------------------------------------
 * 设计：浅色卡片 + 命令列表，支持 ↑↓ 选择、Enter 执行、Esc 关闭。
 * 使用 fixed 定位，由外层通过 coords 传入位置。
 */
import styled from 'styled-components';
import { useEffect, useRef } from 'react';
import { tokens } from '../theme/tokens';
import type { SlashCommand } from '../commands/types';

export interface CommandMenuProps {
  visible: boolean;
  commands: SlashCommand[];
  activeIndex: number;
  /** 锚点坐标（相对 viewport，通过 content editable range 计算） */
  x: number;
  y: number;
  onPick: (cmd: SlashCommand) => void;
  onHover: (index: number) => void;
}

const Wrapper = styled.div<{ $visible: boolean; $x: number; $y: number }>`
  position: fixed;
  left: ${(p) => p.$x}px;
  top: ${(p) => p.$y}px;
  min-width: 260px;
  max-width: 320px;
  background: ${tokens.color.bgWhite};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius.md};
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  padding: 6px;
  font-family: ${tokens.font.family};
  display: ${(p) => (p.$visible ? 'block' : 'none')};
  z-index: ${tokens.zIndex.commandMenu};
  transform-origin: top left;
  animation: commandMenuIn ${tokens.motion.normal};

  @keyframes commandMenuIn {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
`;

const Item = styled.button<{ $active: boolean }>`
  all: unset;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: ${tokens.radius.sm};
  cursor: pointer;
  background: ${(p) => (p.$active ? tokens.color.bgGray : 'transparent')};
  transition: background ${tokens.motion.fast};

  &:hover {
    background: ${tokens.color.bgGray};
  }
`;

const Icon = styled.span`
  font-size: 16px;
  width: 24px;
  text-align: center;
`;

const Meta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const Name = styled.div`
  font-size: ${tokens.font.sizeBody};
  font-weight: 500;
  color: ${tokens.color.textPrimary};
  &::before {
    content: '/';
    opacity: 0.6;
    margin-right: 2px;
  }
`;

const Desc = styled.div`
  font-size: ${tokens.font.sizeSmall};
  color: ${tokens.color.textTertiary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Empty = styled.div`
  padding: 10px;
  color: ${tokens.color.textTertiary};
  font-size: ${tokens.font.sizeSmall};
  text-align: center;
`;

export function CommandMenu({
  visible,
  commands,
  activeIndex,
  x,
  y,
  onPick,
  onHover,
}: CommandMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // 滚动到激活项
  useEffect(() => {
    if (!visible || !ref.current) return;
    const active = ref.current.querySelector<HTMLElement>(`[data-active="true"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [visible, activeIndex]);

  return (
    <Wrapper ref={ref} $visible={visible} $x={x} $y={y} role="menu">
      {commands.length === 0 && <Empty>无匹配命令</Empty>}
      {commands.map((cmd, i) => (
        <Item
          key={cmd.name}
          data-active={i === activeIndex}
          $active={i === activeIndex}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            // 阻止失焦导致 editor blur 关闭菜单
            e.preventDefault();
            onPick(cmd);
          }}
        >
          <Icon>{cmd.icon ?? '•'}</Icon>
          <Meta>
            <Name>{cmd.name}</Name>
            <Desc>{cmd.description}</Desc>
          </Meta>
        </Item>
      ))}
    </Wrapper>
  );
}
