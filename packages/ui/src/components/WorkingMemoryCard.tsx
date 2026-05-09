/**
 * WorkingMemoryCard · sidebar 顶部的工作记忆卡片
 * ---------------------------------------------
 * v0.2.1 · 显示当前 canonicalUrl 对应的 activeGoal + TODO 进度。
 * v1.1 PR-3 C1 · 视觉壳迁移到通用 `StatusStrip`（左侧 3px 灰蓝 accent + 单行 32-36px），
 *   展开态保留原来的 goal 详情 + TODO 列表渲染;业务逻辑不变。
 *
 * 视觉：
 * - 折叠态(StatusStrip 顶部行): 🎯 · 目标(label) · 3/5 TODO 已完成(meta 省略) · chevron
 * - 展开态(StatusStrip body): goal 详情 + TODO list(双通道图标/done 中划线)
 *
 * 鸭子类型：仅依赖 WorkingMemoryView(见下方), 避免 UI 反向依赖 @doc-assistant/memory。
 * 刷新策略：由调用方(ChatPanel)通过 `wm` props 传入,自身不 fetch。
 */
import { useState } from 'react';
import styled from 'styled-components';
import { compact } from '@doc-assistant/shared';
import { tokens } from '../theme/tokens';
import { StatusStrip, StatusStripChevron } from './StatusStrip';

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

  // label(主文案) = goal 或占位;meta = 进度(x/y)
  const labelText = wm.activeGoal ?? '当前页面的 TODO';
  const metaText = total > 0 ? `${done}/${total}` : undefined;

  return (
    <StatusStrip
      accentColor={tokens.color.accentWM}
      icon={<span>🎯</span>}
      label={<span style={{
        maxWidth: 180,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        display: 'inline-block',
        verticalAlign: 'bottom',
      }} title={labelText}>{labelText}</span>}
      {...compact({ meta: metaText })}
      action={<StatusStripChevron $open={open}>›</StatusStripChevron>}
      expanded={open}
      onToggle={() => setOpen((v) => !v)}
      ariaLabel="WorkingMemory 卡片"
    >
      {/* 展开态优先显示 activeGoal 详情(折叠态 Title 超长会省略) */}
      {wm.activeGoal && (
        <GoalDetail>
          <span style={{ color: tokens.color.textTertiary }}>目标:</span>
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
    </StatusStrip>
  );
}
