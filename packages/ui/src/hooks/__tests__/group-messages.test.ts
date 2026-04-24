/**
 * 单测：groupMessagesByVisit（跨 visit 消息分组与 system 段注入）
 */
import { describe, it, expect } from 'vitest';
import { groupMessagesByVisit, type UIMessage } from '../useStreamingChat';

function m(
  role: 'user' | 'assistant',
  content: string,
  visitId?: string,
  visitTitle?: string,
): UIMessage {
  const base: UIMessage = { id: `${role}-${content.slice(0, 4)}`, role, content };
  if (visitId) base.visitId = visitId;
  if (visitTitle) base.visitTitle = visitTitle;
  return base;
}

describe('groupMessagesByVisit', () => {
  it('空数组 → 空数组', () => {
    expect(groupMessagesByVisit([], 'v1')).toEqual([]);
  });

  it('全部是当前 visit → 原文透传，不前置 system', () => {
    const out = groupMessagesByVisit(
      [m('user', '你好', 'v1'), m('assistant', '你好', 'v1'), m('user', '继续', 'v1')],
      'v1',
    );
    expect(out).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好' },
      { role: 'user', content: '继续' },
    ]);
  });

  it('全部是旧 visit → 前置一条 system 段标注来源', () => {
    const out = groupMessagesByVisit(
      [m('user', '问题 A', 'v-old', 'React 架构'), m('assistant', '回答 A', 'v-old', 'React 架构')],
      'v-new',
    );
    expect(out).toHaveLength(3); // 1 system + 2 原文
    expect(out[0]!.role).toBe('system');
    expect(out[0]!.content).toContain('React 架构');
    expect(out[0]!.content).toContain('2 条');
    expect(out[1]).toEqual({ role: 'user', content: '问题 A' });
    expect(out[2]).toEqual({ role: 'assistant', content: '回答 A' });
  });

  it('混合：旧 visit 前置 system，当前 visit 原文', () => {
    const out = groupMessagesByVisit(
      [
        m('user', '旧问题', 'v-old', '上篇'),
        m('assistant', '旧回答', 'v-old', '上篇'),
        m('user', '新问题', 'v-new', '本篇'),
        m('assistant', '新回答', 'v-new', '本篇'),
      ],
      'v-new',
    );
    expect(out).toHaveLength(5); // 1 system + 2 旧 + 2 新
    expect(out[0]!.role).toBe('system');
    expect(out[0]!.content).toContain('上篇');
    expect(out[1]).toEqual({ role: 'user', content: '旧问题' });
    expect(out[2]).toEqual({ role: 'assistant', content: '旧回答' });
    expect(out[3]).toEqual({ role: 'user', content: '新问题' });
    expect(out[4]).toEqual({ role: 'assistant', content: '新回答' });
  });

  it('多个旧 visit → 每组独立前置 system', () => {
    const out = groupMessagesByVisit(
      [
        m('user', 'Q1', 'v1', '文章1'),
        m('user', 'Q2', 'v2', '文章2'),
        m('assistant', 'A2', 'v2', '文章2'),
        m('user', 'Q3', 'v-now', '当前'),
      ],
      'v-now',
    );
    // 预期：system(v1) + Q1 + system(v2) + Q2 + A2 + Q3 = 6
    expect(out).toHaveLength(6);
    expect(out[0]!.role).toBe('system');
    expect(out[0]!.content).toContain('文章1');
    expect(out[1]).toEqual({ role: 'user', content: 'Q1' });
    expect(out[2]!.role).toBe('system');
    expect(out[2]!.content).toContain('文章2');
    expect(out[3]).toEqual({ role: 'user', content: 'Q2' });
    expect(out[4]).toEqual({ role: 'assistant', content: 'A2' });
    expect(out[5]).toEqual({ role: 'user', content: 'Q3' });
  });

  it('无 visitId 的旧消息 → 视为当前 visit，不降级', () => {
    // 兼容 v0.2.4 之前沉淀在 UI 的消息（它们没有 visitId 字段）
    const out = groupMessagesByVisit(
      [m('user', '旧 UI 消息'), m('user', '新消息', 'v1', '当前')],
      'v1',
    );
    // 无 visitId → bufferVisitId=null → 与 v1 不同 → 但 isCurrent 判定 null 视作当前 → 不加 system
    // 两组：第一组 null；第二组 v1。第一组 isCurrent=true，不加 system；第二组也是当前，不加
    expect(out).toEqual([
      { role: 'user', content: '旧 UI 消息' },
      { role: 'user', content: '新消息' },
    ]);
  });

  it('currentVisitId=null（尚未建立 visit）→ 带 visitId 的旧消息会被标为历史', () => {
    // 设计选择：没有当前 visit 说明 PageVisitManager 还没就绪；
    // 此时任何带 visitId 的消息都来自过去，全部降级标注更安全
    const out = groupMessagesByVisit(
      [m('user', 'A', 'v1', 'x'), m('user', 'B', 'v2', 'y')],
      null,
    );
    expect(out).toHaveLength(4); // 2 system + 2 原文
    expect(out[0]!.role).toBe('system');
    expect(out[0]!.content).toContain('x');
    expect(out[1]).toEqual({ role: 'user', content: 'A' });
    expect(out[2]!.role).toBe('system');
    expect(out[2]!.content).toContain('y');
    expect(out[3]).toEqual({ role: 'user', content: 'B' });
  });

  it('currentVisitId=null 且消息无 visitId → 全部视为当前，不加 system', () => {
    // 这是 v0.2.4 之前的全旧数据 + 尚未建立 visit 的情形，应当保持平静
    const out = groupMessagesByVisit([m('user', 'A'), m('user', 'B')], null);
    expect(out).toEqual([
      { role: 'user', content: 'A' },
      { role: 'user', content: 'B' },
    ]);
  });

  it('旧 visit 无 title → 使用默认标签"上一篇文章"', () => {
    const out = groupMessagesByVisit([m('user', 'X', 'v-old')], 'v-new');
    expect(out[0]!.role).toBe('system');
    expect(out[0]!.content).toContain('上一篇文章');
  });
});
