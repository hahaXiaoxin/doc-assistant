/**
 * ReferenceTag · 输入框内的引用 chip 渲染
 * ---------------------------------------------
 * 被 Lexical ReferenceNode 的 decorate() 调用。
 * 视觉：浅紫底色圆角 chip，前缀 @，hover 可查看完整引用文本 tooltip。
 */
import styled from 'styled-components';
import { tokens } from '../theme/tokens';
import type { ReferencePayload } from '../editor/nodes/ReferenceNode';

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 8px;
  margin: 0 2px;
  border-radius: ${tokens.radius.sm};
  background: ${tokens.color.bgThinking};
  color: ${tokens.color.primaryActive};
  font-size: ${tokens.font.sizeSmall};
  font-weight: 500;
  line-height: 1.6;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid rgba(9, 88, 217, 0.12);
  vertical-align: baseline;
  cursor: default;
  user-select: none;
`;

export function ReferenceTag({ payload }: { payload: ReferencePayload }) {
  const preview = payload.text.replace(/\s+/g, ' ').trim();
  return (
    <Chip
      title={preview}
      contentEditable={false}
      aria-label={`引用：${preview}`}
    >
      <span>@</span>
      <span>{preview.slice(0, 24) + (preview.length > 24 ? '…' : '')}</span>
    </Chip>
  );
}
