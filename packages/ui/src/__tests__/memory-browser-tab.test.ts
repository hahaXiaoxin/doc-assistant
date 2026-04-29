/**
 * MemoryBrowserTab · 纯函数单测
 * ---------------------------------------------
 * UI 交互的覆盖走 Dexie 端 + 手测；这里主要盖按日期分组的核心逻辑。
 */
import { describe, it, expect } from 'vitest';
import type { MemoryRecord } from '@doc-assistant/memory';
import { groupVisitsByDate } from '../features/options/tabs/MemoryBrowserTab';

function mkVisit(id: string, ts: number): MemoryRecord {
  return {
    id,
    type: 'visit_summary',
    content: `summary-${id}`,
    timestamp: ts,
  };
}

describe('MemoryBrowserTab · groupVisitsByDate', () => {
  // 固定 now：2026-04-29 14:30 本地时间
  const now = new Date(2026, 3, 29, 14, 30, 0, 0).getTime();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  it('按 今天/昨天/本周/更早 正确分组', () => {
    const todayNoon = new Date(2026, 3, 29, 12, 0, 0, 0).getTime();
    const yesterdayEvening = new Date(2026, 3, 28, 20, 0, 0, 0).getTime();
    // 2026-04-27 周一 10:00 → 本周（this-week 以周一为起点）
    const mondayThisWeek = new Date(2026, 3, 27, 10, 0, 0, 0).getTime();
    const earlier = now - 30 * MS_PER_DAY;

    const visits = [
      mkVisit('today', todayNoon),
      mkVisit('yst', yesterdayEvening),
      mkVisit('week', mondayThisWeek),
      mkVisit('old', earlier),
    ];
    const grouped = groupVisitsByDate(visits, now);

    expect(grouped.today.map((v) => v.id)).toEqual(['today']);
    expect(grouped.yesterday.map((v) => v.id)).toEqual(['yst']);
    expect(grouped['this-week'].map((v) => v.id)).toEqual(['week']);
    expect(grouped.earlier.map((v) => v.id)).toEqual(['old']);
  });

  it('空列表返回空组', () => {
    const grouped = groupVisitsByDate([], now);
    expect(grouped.today).toEqual([]);
    expect(grouped.yesterday).toEqual([]);
    expect(grouped['this-week']).toEqual([]);
    expect(grouped.earlier).toEqual([]);
  });

  it('今天的开始与结束边界正确（00:00 属今天、次日 00:00 不属今天）', () => {
    const todayStart = new Date(2026, 3, 29, 0, 0, 0, 0).getTime();
    const nextDayStart = new Date(2026, 3, 30, 0, 0, 0, 0).getTime();
    const grouped = groupVisitsByDate(
      [mkVisit('start', todayStart), mkVisit('next', nextDayStart)],
      now,
    );
    expect(grouped.today.map((v) => v.id)).toEqual(['start']);
    // next 属于未来一天，不属于 today/yesterday/this-week（仍在本周内），
    // Monday-start this-week 的窗口是 [本周一 00:00, 下周一 00:00)；
    // 2026-04-30 落在本周区间内 → 会归入 this-week
    expect(grouped['this-week'].map((v) => v.id)).toEqual(['next']);
  });
});
