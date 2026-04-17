/**
 * MessageBubble · 单条消息气泡
 * ---------------------------------------------
 * - 用户消息右对齐，浅蓝底
 * - 助手消息左对齐，浅灰底
 * - 流式未完成时末尾显示光标
 * - 代码块（\`\`\`）简单 mono 字体渲染；完整 markdown 留 PHASE2
 */
import styled, { keyframes } from 'styled-components';
import { tokens } from '../theme/tokens';

export interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: boolean;
}

const blink = keyframes`
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
`;

const Row = styled.div<{ $role: 'user' | 'assistant' }>`
  display: flex;
  justify-content: ${(p) => (p.$role === 'user' ? 'flex-end' : 'flex-start')};
  padding: 0 4px;
`;

const Bubble = styled.div<{ $role: 'user' | 'assistant'; $error?: boolean }>`
  max-width: 88%;
  padding: 10px 14px;
  border-radius: ${tokens.radius.lg};
  font-size: ${tokens.font.sizeBody};
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  background: ${(p) =>
    p.$error
      ? 'rgba(255, 77, 79, 0.08)'
      : p.$role === 'user'
        ? tokens.color.bgUserMsg
        : tokens.color.bgGray};
  color: ${(p) => (p.$error ? tokens.color.danger : tokens.color.textPrimary)};
  border: 1px solid
    ${(p) =>
      p.$error
        ? 'rgba(255, 77, 79, 0.24)'
        : p.$role === 'user'
          ? 'rgba(22, 119, 255, 0.12)'
          : 'transparent'};
  box-shadow: ${tokens.shadow.card};

  code {
    font-family: ${tokens.font.mono};
    font-size: ${tokens.font.sizeCode};
    background: rgba(0, 0, 0, 0.06);
    border-radius: 4px;
    padding: 1px 4px;
  }

  pre {
    margin: 8px 0 0;
    padding: 10px 12px;
    border-radius: ${tokens.radius.sm};
    background: #1f1f1f;
    color: #eaeaea;
    font-family: ${tokens.font.mono};
    font-size: ${tokens.font.sizeCode};
    overflow-x: auto;
  }
`;

const Cursor = styled.span`
  display: inline-block;
  width: 2px;
  height: 1em;
  background: ${tokens.color.primary};
  margin-left: 2px;
  vertical-align: -2px;
  animation: ${blink} 1s step-end infinite;
`;

/** 极简 markdown 渲染：只处理 ``` 代码块，保留其余为纯文本 */
function renderBasicMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /```(?:[a-zA-Z]*\n)?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(<span key={`t${i}`}>{text.slice(last, match.index)}</span>);
    }
    parts.push(<pre key={`c${i}`}>{match[1]}</pre>);
    last = match.index + match[0].length;
    i++;
  }
  if (last < text.length) {
    parts.push(<span key={`t${i}`}>{text.slice(last)}</span>);
  }
  return parts;
}

export function MessageBubble({ role, content, streaming, error }: MessageBubbleProps) {
  return (
    <Row $role={role}>
      <Bubble $role={role} {...(error ? { $error: true } : {})}>
        {renderBasicMarkdown(content)}
        {streaming && <Cursor />}
      </Bubble>
    </Row>
  );
}
