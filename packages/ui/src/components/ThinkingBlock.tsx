/**
 * ThinkingBlock · 思考过程折叠块
 * ---------------------------------------------
 * - 流式中默认展开，结束后自动收起
 * - 用浅紫底色弱化存在感
 */
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';

export interface ThinkingBlockProps {
  content: string;
  streaming: boolean;
  elapsedMs?: number;
}

const Wrap = styled.div`
  margin: 0 4px 8px;
  background: ${tokens.color.bgThinking};
  border: 1px solid rgba(9, 88, 217, 0.08);
  border-radius: ${tokens.radius.md};
  overflow: hidden;
  font-size: ${tokens.font.sizeSmall};
  color: ${tokens.color.textSecondary};
`;

const Header = styled.button`
  all: unset;
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  color: ${tokens.color.primaryActive};
  font-weight: 500;
  &:hover {
    background: rgba(22, 119, 255, 0.04);
  }
`;

const Body = styled.div<{ $open: boolean }>`
  max-height: ${(p) => (p.$open ? '320px' : '0')};
  overflow: auto;
  padding: ${(p) => (p.$open ? '4px 12px 10px' : '0 12px')};
  transition: max-height ${tokens.motion.emphasized}, padding ${tokens.motion.fast};
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
`;

export function ThinkingBlock({ content, streaming, elapsedMs }: ThinkingBlockProps) {
  const [open, setOpen] = useState<boolean>(true);
  useEffect(() => {
    // 流式结束后自动收起
    if (!streaming) {
      const t = setTimeout(() => setOpen(false), 600);
      return () => clearTimeout(t);
    }
    return;
  }, [streaming]);

  const label = streaming
    ? '思考中…'
    : typeof elapsedMs === 'number'
      ? `已思考 ${(elapsedMs / 1000).toFixed(1)}s`
      : '已思考';

  return (
    <Wrap>
      <Header onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>🧠 {label}</span>
        <span>{open ? '收起' : '展开'}</span>
      </Header>
      <Body $open={open}>{content || '（无思考过程）'}</Body>
    </Wrap>
  );
}
