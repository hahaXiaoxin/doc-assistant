/**
 * WorkingMemoryCard · sidebar 顶部的工作记忆卡片
 * ---------------------------------------------
 * v0.2.1 · 显示当前 canonicalUrl 对应的 activeGoal + TODO 进度。
 *
 * 视觉：
 * - 折叠态：一行：目标 · `3/5 TODO 已完成` · 小箭头
 * - 展开态：展开列出 TODO，每条有 status 图标（pending / in_progress / done / skipped）
 *
 * 鸭子类型：仅依赖 WorkingMemoryView（见下方），避免 UI 反向依赖 @doc-assistant/memory。
 * 刷新策略：由调用方（ChatPanel）通过 `wm` props 传入，自身不 fetch。
 */
import { useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';

export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'skipped';

export interface WorkingMemoryTodoView {
  id: string;
  content: string;
  status: TodoStatus;
  priority?: 'high' | 'normal' | 'low';
  notes?: string;
}

export interface WorkingMemoryView {
  canonicalUrl: string;
  activeGoal?: string;
  todos: WorkingMemoryTodoView[];
}

export interface WorkingMemoryCardProps {
  wm: WorkingMemoryView | null;
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

const Progress = styled.span`
  color: ${tokens.color.textTertiary};
  font-size: ${tokens.font.sizeSmall};
  flex-shrink: 0;
`;

const Chevron = styled.span<{ $open: boolean }>`
  display: inline-block;
  transition: transform ${tokens.motion.fast};
  transform: rotate(${(p) => (p.$open ? 90 : 0)}deg);
  color: ${tokens.color.textTertiary};
`;

const List = styled.ul`
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const TodoRow = styled.li<{ $done: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: ${(p) => (p.$done ? tokens.color.textTertiary : tokens.color.textPrimary)};
  text-decoration: ${(p) => (p.$done ? 'line-through' : 'none')};
  font-size: ${tokens.font.sizeSmall};
  line-height: 1.5;
`;

const StatusIcon = styled.span<{ $status: TodoStatus }>`
  width: 14px;
  flex-shrink: 0;
  text-align: center;
  color: ${(p) =>
    p.$status === 'done'
      ? tokens.color.success
      : p.$status === 'in_progress'
        ? tokens.color.primary
        : p.$status === 'skipped'
          ? tokens.color.textTertiary
          : tokens.color.textSecondary};
`;

const GoalDetail = styled.div`
  margin-top: 8px;
  padding: 6px 8px;
  background: ${tokens.color.bgWhite};
  border-radius: ${tokens.radius.sm};
  font-size: ${tokens.font.sizeSmall};
  color: ${tokens.color.textPrimary};
  line-height: 1.5;
  word-break: break-word;
`;

const EmptyHint = styled.div`
  margin-top: 6px;
  color: ${tokens.color.textTertiary};
  font-size: ${tokens.font.sizeSmall};
  font-style: italic;
`;

function statusSymbol(s: TodoStatus): string {
  switch (s) {
    case 'done':
      return '✔';
    case 'in_progress':
      return '▸';
    case 'skipped':
      return '⨯';
    default:
      return '○';
  }
}

export function WorkingMemoryCard({ wm }: WorkingMemoryCardProps): JSX.Element | null {
  const [open, setOpen] = useState(false);

  // 无 WorkingMemory 或 todos 为空且无 activeGoal → 不显示
  if (!wm) return null;
  if (!wm.activeGoal && wm.todos.length === 0) return null;

  const total = wm.todos.length;
  const done = wm.todos.filter((t) => t.status === 'done' || t.status === 'skipped').length;

  return (
    <Wrap aria-label="WorkingMemory 卡片">
      <Header onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>🎯</span>
        <Title>{wm.activeGoal ?? '当前页面的 TODO'}</Title>
        {total > 0 && (
          <Progress>
            {done}/{total}
          </Progress>
        )}
        <Chevron $open={open}>›</Chevron>
      </Header>
      {open && (
        <>
          {/* 展开态优先显示 activeGoal 详情（折叠态 Title 超长会省略） */}
          {wm.activeGoal && (
            <GoalDetail>
              <span style={{ color: tokens.color.textTertiary }}>目标：</span>
              {wm.activeGoal}
            </GoalDetail>
          )}
          {total > 0 ? (
            <List>
              {wm.todos.map((t) => (
                <TodoRow key={t.id} $done={t.status === 'done' || t.status === 'skipped'}>
                  <StatusIcon $status={t.status} aria-label={t.status}>
                    {statusSymbol(t.status)}
                  </StatusIcon>
                  <span>
                    {t.content}
                    {t.notes ? (
                      <span style={{ color: tokens.color.textTertiary, marginLeft: 6 }}>
                        · {t.notes}
                      </span>
                    ) : null}
                  </span>
                </TodoRow>
              ))}
            </List>
          ) : (
            <EmptyHint>暂无 TODO</EmptyHint>
          )}
        </>
      )}
    </Wrap>
  );
}
