/**
 * PersonaReviewBanner · sidebar 顶部"待审核 Persona 定义"折叠条
 * ---------------------------------------------
 * v0.2.1 · 反思 Job(persona_extraction) 产出的 pending PersonaRecord 在此浮现。
 * v0.4.0 · Persona 双主体：每条候选带 `subject: 'agent' | 'user'` 标注
 *   (在定义 agent / 在定义 user)。banner 用 `[关于你]` / `[关于用户]` 徽章
 *   与注入段落标题保持一致。
 * v1.1 PR-3 C1 · 视觉壳迁移到通用 `StatusStrip`(左侧 3px 琥珀 accent + 单行 32-36px),
 *   展开态继续渲染 PersonaRow 列表;业务逻辑(onConfirm/onReject)保持不变。
 *
 * 视觉：
 * - 折叠态(StatusStrip 顶部行): 📌 · `N 条 Persona 定义待审核` · meta 省略(主体分布) · chevron
 * - 展开态(StatusStrip body): 逐条 subject 徽章 / content / tags / 采纳 / 忽略
 *
 * UX：
 * - 每次 mount 与对话结束时刷新(由父组件通过 `refreshKey` 触发)。
 * - 采纳/忽略调用 `onConfirm(id)` / `onReject(id)`,成功后本地列表剔除该条。
 *
 * 鸭子类型：仅依赖 PersonaView(见下方),保持 UI 不反向依赖 memory 类型。
 */
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { compact } from '@doc-assistant/shared';
import { tokens } from '../theme/tokens';
import { StatusStrip, StatusStripChevron } from './StatusStrip';

export type PersonaSubjectView = 'agent' | 'user';

export interface PersonaView {
  id: string;
  subject: PersonaSubjectView;
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
  /** 打开配置页(批量管理) */
  onOpenOptions?: () => void;
  /**
   * 外部信号：当其变化时重新获取列表(由 ChatPanel 监听 chat.streaming 跳回 null 时递增)。
   */
  refreshKey?: number;
}

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

const SubjectBadge = styled.span<{ $subject: PersonaSubjectView }>`
  display: inline-block;
  margin-right: 6px;
  padding: 0 6px;
  border-radius: ${tokens.radius.pill};
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  color: ${(p) =>
    p.$subject === 'agent' ? tokens.color.primary : tokens.color.textSecondary};
  background: ${(p) =>
    p.$subject === 'agent'
      ? 'rgba(22, 119, 255, 0.1)'
      : tokens.color.bgSoft};
  border: 1px solid
    ${(p) =>
      p.$subject === 'agent'
        ? 'rgba(22, 119, 255, 0.25)'
        : tokens.color.border};
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
  padding: 4px 0 0;

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

  const agentCount = list.filter((p) => p.subject === 'agent').length;
  const userCount = list.filter((p) => p.subject === 'user').length;

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

  const metaParts: string[] = [];
  if (agentCount > 0) metaParts.push(`关于你 ${agentCount}`);
  if (userCount > 0) metaParts.push(`关于用户 ${userCount}`);
  const metaText = metaParts.length > 0 ? metaParts.join(' · ') : undefined;

  return (
    <StatusStrip
      accentColor={tokens.color.accentPersona}
      icon={<span>📌</span>}
      label={`${list.length} 条待审核`}
      {...compact({ meta: metaText })}
      action={<StatusStripChevron $open={open}>›</StatusStripChevron>}
      expanded={open}
      onToggle={() => setOpen((v) => !v)}
      ariaLabel="Persona 定义审核条"
    >
      <List>
        {list.map((p) => (
          <PersonaRow key={p.id}>
            <PersonaBody>
              <PersonaContent>
                <SubjectBadge $subject={p.subject}>
                  {p.subject === 'agent' ? '[关于你]' : '[关于用户]'}
                </SubjectBadge>
                {p.content}
              </PersonaContent>
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
                采纳
              </ActionButton>
              <ActionButton
                $variant="danger"
                disabled={!!busy[p.id]}
                onClick={() => void handle(p.id, 'reject')}
              >
                忽略
              </ActionButton>
            </Actions>
          </PersonaRow>
        ))}
        {onOpenOptions && (
          <LinkButton onClick={onOpenOptions}>去配置页批量管理 →</LinkButton>
        )}
      </List>
    </StatusStrip>
  );
}
