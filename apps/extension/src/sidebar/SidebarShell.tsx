/**
 * SidebarShell · 侧边栏容器骨架
 * ---------------------------------------------
 * MVP commit 3 版本：仅提供折叠/展开的面板外壳 + 占位内容。
 * commit 8 会把真正的 ChatPanel 塞进来。
 *
 * 设计：
 * - 右侧吸附（fixed right: 0; top/bottom: 0）
 * - 展开态：默认宽 420px，可拖拽（拖拽逻辑在 commit 8 完善）
 * - 折叠态：仅显示右边缘 44x44 的圆形图标
 * - 轻 Glassmorphism：白色半透明 + backdrop-filter blur
 */
import styled, { keyframes } from 'styled-components';
import { useMemo } from 'react';

export interface SidebarShellProps {
  visible: boolean;
  onClose: () => void;
}

const slideIn = keyframes`
  from { transform: translateX(24px); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
`;

const Panel = styled.aside<{ $visible: boolean }>`
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  max-width: 90vw;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: saturate(180%) blur(18px);
  -webkit-backdrop-filter: saturate(180%) blur(18px);
  box-shadow: -12px 0 32px rgba(0, 0, 0, 0.08);
  border-left: 1px solid rgba(0, 0, 0, 0.06);
  display: ${(p) => (p.$visible ? 'flex' : 'none')};
  flex-direction: column;
  font-family: 'PingFang SC', -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #1f1f1f;
  animation: ${slideIn} 200ms ease-out;
  z-index: 2147483647;
`;

const Header = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  height: 44px;
  box-sizing: border-box;
  font-size: 14px;
  font-weight: 600;
`;

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Dot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: linear-gradient(135deg, #1677ff 0%, #0958d9 100%);
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.12);
`;

const IconButton = styled.button`
  all: unset;
  cursor: pointer;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: #595959;
  font-size: 16px;
  transition: background 120ms ease;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
    color: #1f1f1f;
  }
  &:active {
    background: rgba(0, 0, 0, 0.08);
  }
`;

const Body = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  color: #8c8c8c;
  text-align: center;
  font-size: 13px;
  line-height: 1.6;
`;

const Pill = styled.div`
  padding: 4px 10px;
  border-radius: 999px;
  background: #f4f1fb;
  color: #0958d9;
  font-size: 12px;
  font-weight: 500;
`;

export function SidebarShell({ visible, onClose }: SidebarShellProps) {
  const tip = useMemo(
    () => [
      '✨ MVP commit 3 占位界面',
      '对话面板、Lexical 输入框、斜杠命令将在后续 commit 接入',
      '点击右上角 ✕ 关闭侧边栏',
    ],
    [],
  );

  return (
    <Panel $visible={visible} aria-hidden={!visible}>
      <Header>
        <Title>
          <Dot />
          <span>Doc Assistant</span>
        </Title>
        <div style={{ display: 'flex', gap: 4 }}>
          <IconButton
            title="打开配置"
            onClick={() => chrome.runtime.sendMessage({ type: 'doc-assistant/open-options' })}
          >
            ⚙
          </IconButton>
          <IconButton title="关闭侧边栏" onClick={onClose}>
            ✕
          </IconButton>
        </div>
      </Header>
      <Body>
        <Pill>Preview · v0.1</Pill>
        {tip.map((t, i) => (
          <div key={i}>{t}</div>
        ))}
      </Body>
    </Panel>
  );
}
