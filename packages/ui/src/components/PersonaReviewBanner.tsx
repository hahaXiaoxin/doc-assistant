/**
 * PersonaReviewBanner · sidebar 顶部"待审核 Persona"折叠条
 * ---------------------------------------------
 * v0.2.1 · 反思 Job（persona_extraction）产出的 pending PersonaRecord 在此浮现。
 *
 * 视觉：
 * - 折叠态（默认）：一行：🧠 `N 条新的个性记忆待审核` · 箭头
 * - 展开态：逐条显示 content / tags / [✓ 接受] [✗ 拒绝] [设置] 三个按钮。
 *   "设置"不在此直接处理，引导用户去 options 页批量管理（传 onOpenOptions）。
 *
 * UX：
 * - 每次 mount 与对话结束时刷新（由父组件通过 `refreshKey` 触发）。
 * - 接受/拒绝调用 `onConfirm(id)` / `onReject(id)`，成功后本地列表剔除该条。
 *
 * 鸭子类型：仅依赖 PersonaView（见下方），保持 UI 不反向依赖 memory 类型。
 */
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';

export interface PersonaView {
  id: string;
  content: string;
  confidence: number;
  tags?: string[];
  /** 来源 visit 时间 / reviewed 状态等可选展示 */
  createdAt?: number;
}

export interface PersonaReviewBannerProps {
  /**
   * 获取 pending 列表的异步函数；返回空数组组件自动隐藏。
   */
  getPending: () => Promise<PersonaView[]>;
  /** 通过/拒绝操作 */
  onConfirm: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  /** 打开配置页（批量管理） */
  onOpenOptions?: () => void;
  /**
   * 外部信号：当其变化时重新获取列表（由 ChatPanel 监听 chat.streaming 跳回 null 时递增）。
   */
  refreshKey?: number;
}

const Wrap = styled.div`
  margin: 10px 12px 0;
  padding: 8px 12px;
  background: ${tokens.color.bgThinking};
  border: 1px solid rgba(9, 88, 217, 0.15);
  border-radius: ${tokens.radius.sm};
  font-size: ${tokens.font.sizeSmall};
  flex-shrink: 0;
`;

const Header = styled.button`
  all: unset;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  color: ${tokens.color.textPrimary};

  &:focus-visible {
    outline: 2px solid ${tokens.color.primary};
    outline-offset: 2px;
    border-radius: ${tokens.radius.sm};
  }
`;

const Title = styled.span`
  flex: 1;
  font-weight: 500;
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
  gap: 8px;
`;

const PersonaRow = styled.li`
  padding: 6px 8px;
  background: ${tokens.color.bgWhite};
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius.sm};
  display: flex;
  align-items: flex-start;
  gap: 8px;
`;

const PersonaBody = styled.div`
  flex: 1;
  min-width: 0;
`;

const PersonaContent = styled.div`
  color: ${tokens.color.textPrimary};
  font-size: ${tokens.font.sizeBody};
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PersonaMeta = styled.div`
  margin-top: 3px;
  color: ${tokens.color.textTertiary};
  font-size: ${tokens.font.sizeSmall};
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

const Tag = styled.span`
  display: inline-block;
  padding: 0 6px;
  border-radius: ${tokens.radius.pill};
  background: ${tokens.color.bgSoft};
  color: ${tokens.color.textSecondary};
  font-size: 11px;
  line-height: 16px;
`;

const Actions = styled.div`
  display: flex;
  gap: 4px;
  flex-shrink: 0;
`;

const ActionButton = styled.button<{ $variant: 'primary' | 'danger' }>`
  all: unset;
  cursor: pointer;
  padding: 3px 8px;
  border-radius: ${tokens.radius.sm};
  font-size: ${tokens.font.sizeSmall};
  font-weight: 500;
  color: ${(p) =>
    p.$variant === 'primary' ? tokens.color.primary : tokens.color.danger};
  border: 1px solid ${(p) =>
    p.$variant === 'primary' ? tokens.color.primary : tokens.color.danger};
  transition: background ${tokens.motion.fast};

  &:hover {
    background: ${(p) =>
      p.$variant === 'primary' ? 'rgba(22,119,255,0.08)' : 'rgba(255,77,79,0.08)'};
  }
`;

const LinkButton = styled.button`
  all: unset;
  cursor: pointer;
  color: ${tokens.color.primary};
  font-size: ${tokens.font.sizeSmall};
  margin-left: auto;

  &:hover {
    text-decoration: underline;
  }
`;

export function PersonaReviewBanner({
  getPending,
  onConfirm,
  onReject,
  onOpenOptions,
  refreshKey = 0,
}: PersonaReviewBannerProps): JSX.Element | null {
  const [list, setList] = useState<PersonaView[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const items = await getPending();
        if (!cancelled) setList(items);
      } catch {
        if (!cancelled) setList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getPending, refreshKey]);

  if (list.length === 0) return null;

  const handle = async (id: string, action: 'confirm' | 'reject') => {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      if (action === 'confirm') await onConfirm(id);
      else await onReject(id);
      setList((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setBusy((b) => {
        const n = { ...b };
        delete n[id];
        return n;
      });
    }
  };

  return (
    <Wrap aria-label="Persona 审核条">
      <Header onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span style={{ fontSize: 14 }}>🧠</span>
        <Title>{list.length} 条新的个性记忆待审核</Title>
        <Chevron $open={open}>›</Chevron>
      </Header>
      {open && (
        <List>
          {list.map((p) => (
            <PersonaRow key={p.id}>
              <PersonaBody>
                <PersonaContent>{p.content}</PersonaContent>
                <PersonaMeta>
                  <span>置信度 {(p.confidence * 100).toFixed(0)}%</span>
                  {p.tags?.map((t) => <Tag key={t}>{t}</Tag>)}
                </PersonaMeta>
              </PersonaBody>
              <Actions>
                <ActionButton
                  $variant="primary"
                  disabled={!!busy[p.id]}
                  onClick={() => void handle(p.id, 'confirm')}
                >
                  接受
                </ActionButton>
                <ActionButton
                  $variant="danger"
                  disabled={!!busy[p.id]}
                  onClick={() => void handle(p.id, 'reject')}
                >
                  拒绝
                </ActionButton>
              </Actions>
            </PersonaRow>
          ))}
          {onOpenOptions && (
            <LinkButton onClick={onOpenOptions}>去配置页批量管理 →</LinkButton>
          )}
        </List>
      )}
    </Wrap>
  );
}
