/**
 * MemoryBrowserTab · 记忆浏览器（v0.4.0 新增）
 * ---------------------------------------------
 * 让用户把黑盒的 IDB 记忆层变成"可见、可审、可清"的时序自传：
 *
 * ① Visit 摘要：按 今天/昨天/本周/更早 分组展示 `episodes_visit_summary`
 * ② Persona：分 Tab 切换 agent / user，支持编辑 content、审核、删除
 * ③ 当前页 WorkingMemory：按 canonicalUrl 列，支持删除 / 清归档
 * ④ 当前话题：最近 20 条 SessionTopic（只读）
 *
 * 调试视角：
 * - 每条记录右侧显示 `{id}` 小灰字（DevTools `await memory.xxx('id')` 直达）
 * - 每个区块上方有统计条
 * - 顶部"刷新数据"按钮（不自动刷新，避免写入路径被观察动作干扰）
 *
 * 编辑边界：
 * - Persona content 可编辑（对应 memory.updatePersona）
 * - Visit 摘要 content 不可编辑（AI 产物，改了没语义）
 * - WorkingMemory 不可编辑（由主 LLM 通过 tool 维护），只能删
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import type {
  MemoryRecord,
  MemoryStore,
  PersonaRecord,
  PersonaSubject,
  SessionTopicRecord,
  WorkingMemoryRecord,
} from '@doc-assistant/memory';
import { resolveTimeRange } from '@doc-assistant/agent';

export interface MemoryBrowserTabProps {
  memory: MemoryStore | null;
  /** 可选：用于测试注入时间源 */
  getNow?: () => number;
}

/** 日期分组 key */
type VisitGroupKey = 'today' | 'yesterday' | 'this-week' | 'earlier';

const GROUP_LABEL: Record<VisitGroupKey, string> = {
  today: '今天',
  yesterday: '昨天',
  'this-week': '本周（更早的天）',
  earlier: '更早',
};

const PURGE_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '7 天前', value: 7 },
  { label: '30 天前', value: 30 },
  { label: '90 天前', value: 90 },
];

export function MemoryBrowserTab({ memory, getNow }: MemoryBrowserTabProps): JSX.Element {
  if (!memory) {
    return (
      <Alert
        type="warning"
        showIcon
        message="记忆层未启用"
        description='请在"基础" Tab 配置主 Provider 后重新打开；记忆层初始化失败时会降级到 NullMemoryStore，此 Tab 将无数据。'
      />
    );
  }

  return <MemoryBrowserTabInner memory={memory} getNow={getNow} />;
}

/* ----------------------------------------------------------------- */
/* 内部组件                                                             */
/* ----------------------------------------------------------------- */

interface InnerProps {
  memory: MemoryStore;
  getNow?: (() => number) | undefined;
}

function MemoryBrowserTabInner({ memory, getNow }: InnerProps): JSX.Element {
  const nowFn = useMemo(() => getNow ?? (() => Date.now()), [getNow]);

  const [tick, setTick] = useState(0);
  const [visits, setVisits] = useState<MemoryRecord[]>([]);
  const [personas, setPersonas] = useState<PersonaRecord[]>([]);
  const [wms, setWms] = useState<WorkingMemoryRecord[]>([]);
  const [topics, setTopics] = useState<SessionTopicRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [v, p, w, t] = await Promise.all([
        memory.listVisitSummaries({ limit: 500 }),
        memory.listPersonas(),
        memory.listWorkingMemories({ limit: 200 }),
        memory.listSessionTopics({ limit: 20 }),
      ]);
      setVisits(v);
      setPersonas(p);
      setWms(w);
      setTopics(t);
    } finally {
      setLoading(false);
    }
  }, [memory]);

  useEffect(() => {
    void refresh();
  }, [refresh, tick]);

  const triggerRefresh = useCallback(() => {
    setTick((x) => x + 1);
  }, []);

  const agentPersonas = personas.filter((p) => p.subject === 'agent');
  const userPersonas = personas.filter((p) => p.subject === 'user');

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <Typography.Text type="secondary">
          所有数据均来自本地 IndexedDB；编辑/删除操作会立即落库，不可撤销。
        </Typography.Text>
        <Button
          type="primary"
          style={{ marginLeft: 'auto' }}
          loading={loading}
          onClick={triggerRefresh}
        >
          刷新数据
        </Button>
      </div>

      <VisitSummarySection
        visits={visits}
        nowFn={nowFn}
        memory={memory}
        onChanged={triggerRefresh}
      />

      <PersonaSection
        agentPersonas={agentPersonas}
        userPersonas={userPersonas}
        memory={memory}
        onChanged={triggerRefresh}
      />

      <WorkingMemorySection wms={wms} memory={memory} onChanged={triggerRefresh} />

      <SessionTopicsSection topics={topics} />
    </>
  );
}

/* ----------------------------------------------------------------- */
/* ① Visit 摘要                                                        */
/* ----------------------------------------------------------------- */

interface VisitSummarySectionProps {
  visits: MemoryRecord[];
  nowFn: () => number;
  memory: MemoryStore;
  onChanged: () => void;
}

function VisitSummarySection({
  visits,
  nowFn,
  memory,
  onChanged,
}: VisitSummarySectionProps): JSX.Element {
  const [purgeDays, setPurgeDays] = useState<number>(30);
  const grouped = useMemo(() => groupVisitsByDate(visits, nowFn()), [visits, nowFn]);
  const domains = new Set<string>();
  visits.forEach((v) => {
    if (v.domain) domains.add(v.domain);
  });

  const handlePurge = async () => {
    const cutoff = nowFn() - purgeDays * 24 * 60 * 60 * 1000;
    const toDelete = visits.filter((v) => v.timestamp < cutoff);
    if (toDelete.length === 0) {
      message.info(`${purgeDays} 天前无记录可清理`);
      return;
    }
    Modal.confirm({
      title: `清理 ${purgeDays} 天前的 Visit 摘要？`,
      content: `即将删除 ${toDelete.length} 条摘要，此操作不可撤销。`,
      okType: 'danger',
      okText: '确认清理',
      cancelText: '取消',
      onOk: async () => {
        for (const rec of toDelete) {
          await memory.deleteRecord(rec.id);
        }
        message.success(`已删除 ${toDelete.length} 条`);
        onChanged();
      },
    });
  };

  const title = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span>① Visit 摘要</span>
      <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>
        共 {visits.length} 条，覆盖 {domains.size} 个域名
      </Typography.Text>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Select
          size="small"
          value={purgeDays}
          options={PURGE_OPTIONS}
          style={{ width: 100 }}
          onChange={(v) => setPurgeDays(v)}
        />
        <Button size="small" danger onClick={() => void handlePurge()}>
          清空
        </Button>
      </div>
    </div>
  );

  return (
    <Card title={title} style={{ marginBottom: 16 }}>
      {visits.length === 0 ? (
        <Empty description="暂无 visit 摘要。开始浏览对话后，AI 会在 PageVisit 结束时自动归纳摘要存到这里。" />
      ) : (
        (['today', 'yesterday', 'this-week', 'earlier'] as const).map((key) => {
          const list = grouped[key];
          if (list.length === 0) return null;
          return (
            <div key={key} style={{ marginBottom: 12 }}>
              <Typography.Title level={5} style={{ marginBottom: 8 }}>
                {GROUP_LABEL[key]}（{list.length}）
              </Typography.Title>
              <Space direction="vertical" style={{ width: '100%' }}>
                {list.map((v) => (
                  <VisitCard
                    key={v.id}
                    visit={v}
                    onDelete={async () => {
                      await memory.deleteRecord(v.id);
                      message.success('已删除');
                      onChanged();
                    }}
                  />
                ))}
              </Space>
            </div>
          );
        })
      )}
    </Card>
  );
}

interface VisitCardProps {
  visit: MemoryRecord;
  onDelete: () => Promise<void>;
}

function VisitCard({ visit, onDelete }: VisitCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const title =
    (visit.meta && typeof (visit.meta as { title?: unknown }).title === 'string'
      ? (visit.meta as { title: string }).title
      : undefined) ??
    visit.url ??
    visit.canonicalUrl ??
    '(无标题)';
  const tags = Array.isArray(visit.topic) ? visit.topic : [];
  const summary = visit.content ?? '';
  const preview = summary.length > 180 ? `${summary.slice(0, 180)}…` : summary;

  return (
    <div
      style={{
        border: '1px solid #f0f0f0',
        borderRadius: 6,
        padding: '8px 12px',
        background: '#fafafa',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text strong ellipsis={{ tooltip: title }}>
            {title}
          </Typography.Text>
          <div
            style={{
              color: '#8c8c8c',
              fontSize: 12,
              marginTop: 2,
            }}
          >
            {visit.domain ?? '—'} · {formatTs(visit.timestamp)} ·{' '}
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {'{'}
              {visit.id}
              {'}'}
            </Typography.Text>
          </div>
          <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 13 }}>
            {expanded ? summary : preview}
          </div>
          {tags.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {tags.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          )}
        </div>
        <Space direction="vertical" size={4}>
          {summary.length > 180 && (
            <Button size="small" onClick={() => setExpanded((e) => !e)}>
              {expanded ? '收起' : '展开'}
            </Button>
          )}
          <Popconfirm
            title="删除该 Visit 摘要？"
            onConfirm={() => void onDelete()}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
          >
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* ② Persona                                                           */
/* ----------------------------------------------------------------- */

interface PersonaSectionProps {
  agentPersonas: PersonaRecord[];
  userPersonas: PersonaRecord[];
  memory: MemoryStore;
  onChanged: () => void;
}

function PersonaSection({
  agentPersonas,
  userPersonas,
  memory,
  onChanged,
}: PersonaSectionProps): JSX.Element {
  const title = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span>② Persona</span>
      <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>
        共 {agentPersonas.length} 条 agent / {userPersonas.length} 条 user
      </Typography.Text>
    </div>
  );

  return (
    <Card title={title} style={{ marginBottom: 16 }}>
      <Tabs
        defaultActiveKey="agent"
        items={[
          {
            key: 'agent',
            label: `关于你（agent · ${agentPersonas.length}）`,
            children: (
              <PersonaList
                subject="agent"
                list={agentPersonas}
                memory={memory}
                onChanged={onChanged}
              />
            ),
          },
          {
            key: 'user',
            label: `关于用户（user · ${userPersonas.length}）`,
            children: (
              <PersonaList
                subject="user"
                list={userPersonas}
                memory={memory}
                onChanged={onChanged}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}

interface PersonaListProps {
  subject: PersonaSubject;
  list: PersonaRecord[];
  memory: MemoryStore;
  onChanged: () => void;
}

function PersonaList({ list, memory, onChanged }: PersonaListProps): JSX.Element {
  if (list.length === 0) {
    return <Empty description="暂无 Persona。对话一段时间后反思 Job 会自动归纳候选。" />;
  }
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {list.map((p) => (
        <PersonaCard
          key={p.id}
          persona={p}
          onSave={async (content) => {
            await memory.updatePersona(p.id, { content }, 'ui_edit');
            message.success('已保存');
            onChanged();
          }}
          onConfirm={async () => {
            await memory.updatePersona(
              p.id,
              { status: 'confirmed', reviewedByUser: true },
              'ui_confirm',
            );
            message.success('已采纳');
            onChanged();
          }}
          onDelete={async () => {
            await memory.deleteRecord(p.id);
            message.success('已删除');
            onChanged();
          }}
        />
      ))}
    </Space>
  );
}

interface PersonaCardProps {
  persona: PersonaRecord;
  onSave: (content: string) => Promise<void>;
  onConfirm: () => Promise<void>;
  onDelete: () => Promise<void>;
}

function PersonaCard({ persona, onSave, onConfirm, onDelete }: PersonaCardProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(persona.content);

  useEffect(() => {
    if (!editing) setDraft(persona.content);
  }, [persona.content, editing]);

  const canConfirm = persona.status === 'pending';

  return (
    <div
      style={{
        border: '1px solid #f0f0f0',
        borderRadius: 6,
        padding: '8px 12px',
        background: '#fafafa',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <Input.TextArea
              value={draft}
              autoSize={{ minRows: 2, maxRows: 6 }}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <Typography.Paragraph style={{ marginBottom: 4 }}>
              {persona.content}
            </Typography.Paragraph>
          )}
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>
            <Tag color={persona.status === 'confirmed' ? 'green' : 'orange'}>
              {persona.status}
            </Tag>
            <span>置信度 {(persona.confidence * 100).toFixed(0)}%</span>
            <span style={{ marginLeft: 8 }}>命中 {persona.hitCount} 次</span>
            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>
              {'{'}
              {persona.id}
              {'}'}
            </Typography.Text>
          </div>
        </div>
        <Space direction="vertical" size={4}>
          {editing ? (
            <>
              <Button
                size="small"
                type="primary"
                onClick={async () => {
                  await onSave(draft.trim() || persona.content);
                  setEditing(false);
                }}
              >
                保存
              </Button>
              <Button size="small" onClick={() => setEditing(false)}>
                取消
              </Button>
            </>
          ) : (
            <>
              <Button size="small" onClick={() => setEditing(true)}>
                编辑
              </Button>
              {canConfirm && (
                <Button size="small" type="primary" onClick={() => void onConfirm()}>
                  采纳
                </Button>
              )}
              <Popconfirm
                title="删除该条 Persona？"
                onConfirm={() => void onDelete()}
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
              >
                <Button size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* ③ WorkingMemory                                                     */
/* ----------------------------------------------------------------- */

interface WorkingMemorySectionProps {
  wms: WorkingMemoryRecord[];
  memory: MemoryStore;
  onChanged: () => void;
}

function WorkingMemorySection({
  wms,
  memory,
  onChanged,
}: WorkingMemorySectionProps): JSX.Element {
  const archived = wms.filter((w) => w.archivedAt);
  const active = wms.filter((w) => !w.archivedAt);

  const handleClearArchived = async () => {
    if (archived.length === 0) {
      message.info('无已归档条目');
      return;
    }
    Modal.confirm({
      title: `清空已归档的 WorkingMemory？`,
      content: `即将删除 ${archived.length} 条，不影响未归档条目。`,
      okType: 'danger',
      onOk: async () => {
        for (const wm of archived) {
          await memory.deleteWorkingMemory(wm.canonicalUrl);
        }
        message.success(`已清空 ${archived.length} 条`);
        onChanged();
      },
    });
  };

  const title = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span>③ WorkingMemory</span>
      <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>
        共 {wms.length} 条（{active.length} 活跃 / {archived.length} 归档）
      </Typography.Text>
      <Button size="small" style={{ marginLeft: 'auto' }} onClick={() => void handleClearArchived()}>
        清空已归档
      </Button>
    </div>
  );

  return (
    <Card title={title} style={{ marginBottom: 16 }}>
      {wms.length === 0 ? (
        <Empty description="暂无 WorkingMemory。打开一个页面，AI 用 write_todos 等 tool 维护任务后会在这里出现。" />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          {wms.map((wm) => (
            <WorkingMemoryItem
              key={wm.canonicalUrl}
              wm={wm}
              onDelete={async () => {
                await memory.deleteWorkingMemory(wm.canonicalUrl);
                message.success('已删除');
                onChanged();
              }}
            />
          ))}
        </Space>
      )}
    </Card>
  );
}

function WorkingMemoryItem({
  wm,
  onDelete,
}: {
  wm: WorkingMemoryRecord;
  onDelete: () => Promise<void>;
}): JSX.Element {
  const pending = wm.todos.filter((t) => t.status !== 'done' && t.status !== 'skipped').length;
  return (
    <div
      style={{
        border: '1px solid #f0f0f0',
        borderRadius: 6,
        padding: '8px 12px',
        background: '#fafafa',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text strong ellipsis={{ tooltip: wm.canonicalUrl }}>
            {wm.canonicalUrl}
          </Typography.Text>
          <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 2 }}>
            {wm.archivedAt ? <Tag color="default">已归档</Tag> : <Tag color="blue">活跃</Tag>}
            <span>目标：{wm.activeGoal ?? '—'}</span>
            <span style={{ marginLeft: 8 }}>
              TODO {wm.todos.length} 条（{pending} 待办）
            </span>
            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>
              {'{'}
              {wm.canonicalUrl}
              {'}'}
            </Typography.Text>
          </div>
        </div>
        <Popconfirm
          title="删除该 WorkingMemory？"
          onConfirm={() => void onDelete()}
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
        >
          <Button size="small" danger>
            删除
          </Button>
        </Popconfirm>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* ④ SessionTopic（只读）                                               */
/* ----------------------------------------------------------------- */

function SessionTopicsSection({ topics }: { topics: SessionTopicRecord[] }): JSX.Element {
  const title = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span>④ 当前话题（最近 20）</span>
      <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>
        共 {topics.length} 条
      </Typography.Text>
    </div>
  );

  return (
    <Card title={title} style={{ marginBottom: 16 }}>
      {topics.length === 0 ? (
        <Empty description="暂无 SessionTopic。对话几轮后辅助 LLM 会识别话题并写入。" />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          {topics.map((t) => (
            <div
              key={t.visitId}
              style={{
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                padding: '8px 12px',
                background: '#fafafa',
              }}
            >
              <div style={{ fontSize: 13 }}>{t.currentTopic}</div>
              <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 2 }}>
                {formatTs(t.updatedAt)} · visit={t.visitId}
                {t.tags.length > 0 && (
                  <span style={{ marginLeft: 8 }}>
                    {t.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </span>
                )}
                <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>
                  {'{'}
                  {t.visitId}
                  {'}'}
                </Typography.Text>
              </div>
            </div>
          ))}
        </Space>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------- */
/* utils                                                              */
/* ----------------------------------------------------------------- */

/**
 * 按日期分组：today / yesterday / this-week / earlier。
 * 复用 agent 层的 `resolveTimeRange` 做边界判定，确保与需求 2 的时间窗语义一致。
 */
export function groupVisitsByDate(
  visits: MemoryRecord[],
  now: number,
): Record<VisitGroupKey, MemoryRecord[]> {
  const { startTs: todayStart, endTs: todayEnd } = resolveTimeRange('today', { now });
  const { startTs: yesterdayStart, endTs: yesterdayEnd } = resolveTimeRange('yesterday', {
    now,
  });
  const { startTs: weekStart, endTs: weekEnd } = resolveTimeRange('this-week', { now });
  const result: Record<VisitGroupKey, MemoryRecord[]> = {
    today: [],
    yesterday: [],
    'this-week': [],
    earlier: [],
  };
  for (const v of visits) {
    if (v.timestamp >= todayStart && v.timestamp < todayEnd) {
      result.today.push(v);
    } else if (v.timestamp >= yesterdayStart && v.timestamp < yesterdayEnd) {
      result.yesterday.push(v);
    } else if (v.timestamp >= weekStart && v.timestamp < weekEnd) {
      result['this-week'].push(v);
    } else {
      result.earlier.push(v);
    }
  }
  return result;
}

function formatTs(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}
