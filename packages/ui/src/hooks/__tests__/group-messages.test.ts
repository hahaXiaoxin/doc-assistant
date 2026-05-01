/**
 * 单测：groupMessagesByVisit（跨 visit 消息分组与 system 段注入）
 */
import { describe, it, expect, vi } from 'vitest';
import { groupMessagesByVisit, type UIMessage } from '../useStreamingChat';

function m(
  role: 'user' | 'assistant',
  content: string,
  visitId: string,
  visitTitle?: string,
): UIMessage {
  const base: UIMessage = { id: `${role}-${content.slice(0, 4)}`, role, content, visitId };
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

  it('currentVisitId=null → 所有 visitId 都会被标为历史', () => {
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

  it('旧 visit 无 title → 使用默认标签"上一篇文章"', () => {
    const out = groupMessagesByVisit([m('user', 'X', 'v-old')], 'v-new');
    expect(out[0]!.role).toBe('system');
    expect(out[0]!.content).toContain('上一篇文章');
  });

  // v0.3.0 · 读取层防腐：缺 visitId 的老数据被过滤 + warn
  it('缺 visitId 的老消息被过滤并 warn 计数', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 构造同时包含合法与非法（缺 visitId）的消息数组。
    // 生产中 TS 已禁止缺 visitId，这里强制 cast 模拟老数据。
    const messages = [
      { id: 'clean', role: 'user' as const, content: '合法', visitId: 'v1' },
      { id: 'dirty', role: 'user' as const, content: '老数据' } as unknown as UIMessage,
    ];
    const out = groupMessagesByVisit(messages, 'v1');
    expect(out).toEqual([{ role: 'user', content: '合法' }]);
    const matched = warnSpy.mock.calls.some((call) =>
      call.some(
        (a) =>
          typeof a === 'string' && /跳过 1 条缺失 visitId/.test(a),
      ),
    );
    expect(matched).toBe(true);
    warnSpy.mockRestore();
  });
});
