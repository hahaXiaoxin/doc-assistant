/**
 * PageContextCard · sidebar 顶部的页面身份/摘要卡片
 * ---------------------------------------------
 * v0.2.4 · 从 ChatPanel 内联的 ContextCard 抽离。
 *
 * 修复问题 6：
 * - 之前只显示"XXX字摘要"这串元信息，用户看不到真实摘要；
 * - 摘要来源是 full-body extractor 时（Readability 失败退化），质量通常很低；
 *   现在展开态会给出"降级来源"的明确提示。
 *
 * 视觉：
 * - 折叠态（默认）：📄 {title}  · 如果有 summary 显示字数，否则"无摘要"；末尾有小箭头
 * - 展开态：
 *   - 真实摘要文本（取前 500 字）
 *   - 如果 extractor='full-body' 或相近低可信来源 → 标一条"来源降级: 可能包含导航/菜单文本"
 *   - URL（小字灰色）
 */
import { useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';

export interface PageContextView {
  title: string;
  url: string;
  summary?: string;
  /** readability / semantic / full-body / selection */
  extractor?: string;
}

export interface PageContextCardProps {
  page: PageContextView | null;
}

const Wrap = styled.div`
  margin: 10px 12px 0;
  padding: 8px 12px;
  background: ${tokens.color.bgSoft};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius.sm};
  font-size: ${tokens.font.sizeSmall};
  color: ${tokens.color.textSecondary};
  flex-shrink: 0;
`;

const Header = styled.button`
  all: unset;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;

  &:focus-visible {
    outline: 2px solid ${tokens.color.primary};
    outline-offset: 2px;
    border-radius: ${tokens.radius.sm};
  }
`;

const Title = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${tokens.color.textPrimary};
  font-weight: 500;
`;

const Meta = styled.span`
  color: ${tokens.color.textTertiary};
  flex-shrink: 0;
`;

const Chevron = styled.span<{ $open: boolean }>`
  display: inline-block;
  transition: transform ${tokens.motion.fast};
  transform: rotate(${(p) => (p.$open ? 90 : 0)}deg);
  color: ${tokens.color.textTertiary};
`;

const Body = styled.div`
  margin-top: 8px;
  padding: 6px 8px;
  background: ${tokens.color.bgWhite};
  border-radius: ${tokens.radius.sm};
  color: ${tokens.color.textPrimary};
  font-size: ${tokens.font.sizeSmall};
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
`;

const DowngradeHint = styled.div`
  margin-top: 6px;
  padding: 4px 8px;
  background: rgba(255, 193, 7, 0.1);
  border-left: 3px solid rgba(255, 193, 7, 0.6);
  border-radius: ${tokens.radius.sm};
  color: ${tokens.color.textSecondary};
  font-size: 11px;
  line-height: 1.4;
`;

const UrlRow = styled.div`
  margin-top: 6px;
  color: ${tokens.color.textTertiary};
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const EmptyHint = styled.span`
  flex: 1;
  color: ${tokens.color.textTertiary};
`;

/** 低可信度 extractor：需要给用户降级提示 */
const LOW_CONFIDENCE_EXTRACTORS = new Set(['full-body']);

export function PageContextCard({ page }: PageContextCardProps): JSX.Element {
  const [open, setOpen] = useState(false);

  if (!page) {
    return (
      <Wrap aria-label="页面上下文卡片">
        <Header as="div">
          <EmptyHint>尚未识别到当前页面信息</EmptyHint>
        </Header>
      </Wrap>
    );
  }

  const summary = page.summary?.trim() ?? '';
  const hasSummary = summary.length > 0;
  const isLowConfidence = !!page.extractor && LOW_CONFIDENCE_EXTRACTORS.has(page.extractor);
  // 展开态显示的摘要最多 500 字（原文完整；UI 层 max-height 再加滚动）
  const summaryDisplay = summary.length > 500 ? `${summary.slice(0, 500)}…` : summary;

  return (
    <Wrap aria-label="页面上下文卡片">
      <Header
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!hasSummary}
        style={{ cursor: hasSummary ? 'pointer' : 'default' }}
      >
        <span style={{ flexShrink: 0 }}>📄</span>
        <Title>{page.title}</Title>
        <Meta>
          {hasSummary
            ? `${summary.length} 字摘要${isLowConfidence ? ' · 低可信' : ''}`
            : '无摘要'}
        </Meta>
        {hasSummary && <Chevron $open={open}>›</Chevron>}
      </Header>
      {open && hasSummary && (
        <>
          <Body>{summaryDisplay}</Body>
          {isLowConfidence && (
            <DowngradeHint>
              ⚠ 摘要来源为 <code>{page.extractor}</code>，可能包含页面导航/菜单等噪声内容。
              模型在回答需要引用原文时会调用 read_page_content 工具拿更完整正文。
            </DowngradeHint>
          )}
          <UrlRow title={page.url}>{page.url}</UrlRow>
        </>
      )}
    </Wrap>
  );
}
