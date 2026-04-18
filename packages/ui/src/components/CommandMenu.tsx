/**
 * CommandMenu · 斜杠命令候选下拉
 * ---------------------------------------------
 * 设计：浅色卡片 + 命令列表，支持 ↑↓ 选择、Enter 执行、Esc 关闭。
 *
 * 定位：position:fixed + 调用方传入 (x, bottom)，菜单恒向上展开、底边贴在输入框上方。
 * 用 CSS `bottom` 锚定的好处：菜单无论多高多矮，底部位置固定，不会受自身高度波动影响。
 *
 * 前提：本组件必须通过 Portal 挂在 **没有 transform 祖先** 的容器里（推荐 shadowRoot）。
 * 否则 CSS 规范下 transform 祖先会为 fixed 子孙重建包含块，导致坐标失真。
 * 详见 docs/TROUBLESHOOTING.md。
 */
import styled from 'styled-components';
import { useEffect, useRef } from 'react';
import { tokens } from '../theme/tokens';
import type { SlashCommand } from '../commands/types';

export interface CommandMenuProps {
  visible: boolean;
  commands: SlashCommand[];
  activeIndex: number;
  /** 菜单左边缘距视口左侧的像素（CSS `left`） */
  x: number;
  /** 菜单底边距视口底部的像素（CSS `bottom`），由调用方算出以贴近输入框顶部 */
  bottom: number;
  onPick: (cmd: SlashCommand) => void;
  onHover: (index: number) => void;
}

const Wrapper = styled.div<{ $visible: boolean; $x: number; $bottom: number }>`
  position: fixed;
  left: ${(p) => p.$x}px;
  bottom: ${(p) => p.$bottom}px;
  min-width: 260px;
  max-width: min(320px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  background: ${tokens.color.bgWhite};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius.md};
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  padding: 6px;
  font-family: ${tokens.font.family};
  display: ${(p) => (p.$visible ? 'block' : 'none')};
  z-index: ${tokens.zIndex.commandMenu};
  transform-origin: bottom left;
  animation: commandMenuIn ${tokens.motion.normal};

  @keyframes commandMenuIn {
    from {
      opacity: 0;
      transform: translateY(4px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
`;

const Item = styled.button<{ $active: boolean }>`
  all: unset;
  box-sizing: border-box;
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
  flex: 1;
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
  bottom,
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
    <Wrapper ref={ref} $visible={visible} $x={x} $bottom={bottom} role="menu">
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
