/**
 * 单测：time-query util（v0.4.0 · Chronological Index）
 */
import { describe, it, expect } from 'vitest';
import {
  detectTimeScopedMetaQuery,
  resolveTimeRange,
  type TimeRangeKey,
} from '../context/time-query';

describe('detectTimeScopedMetaQuery', () => {
  it('正例：时间锚点 + 列举动词', () => {
    expect(detectTimeScopedMetaQuery('今天看了哪些')).toBe(true);
    expect(detectTimeScopedMetaQuery('本周讨论了什么')).toBe(true);
    expect(detectTimeScopedMetaQuery('最近都聊过什么')).toBe(true);
    expect(detectTimeScopedMetaQuery('昨天看了什么文章')).toBe(true);
    expect(detectTimeScopedMetaQuery('what did we talk about today')).toBe(true);
  });

  it('反例：有时间但没列举动词', () => {
    expect(detectTimeScopedMetaQuery('今天这篇文章讲了什么')).toBe(false);
    expect(detectTimeScopedMetaQuery('今天我心情不好')).toBe(false);
  });

  it('反例：有列举动词但没时间锚点', () => {
    expect(detectTimeScopedMetaQuery('我们聊了什么')).toBe(false);
  });

  it('反例：仅历史指向（应走正常语义召回）', () => {
    expect(detectTimeScopedMetaQuery('上次那个方案')).toBe(false);
  });

  it('空输入 → false', () => {
    expect(detectTimeScopedMetaQuery('')).toBe(false);
    expect(detectTimeScopedMetaQuery('   ')).toBe(false);
  });
});

describe('resolveTimeRange', () => {
  // 以一个确定的时间点为基准：2026-04-29 周三 15:30 本地（不同 CI 时区可能偏移，但相对关系恒定）
  // 使用 Date 本地构造以避免时区硬编码
  const NOW = new Date(2026, 3, 29, 15, 30, 0, 0).getTime(); // 月份 0-based：3=April

  function startOfLocalDay(d: Date): number {
    return new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      0,
      0,
      0,
      0,
    ).getTime();
  }

  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  it('today → 本地 00:00 ~ next 00:00', () => {
    const { startTs, endTs } = resolveTimeRange('today', { now: NOW });
    expect(startTs).toBe(startOfLocalDay(new Date(NOW)));
    expect(endTs - startTs).toBe(MS_PER_DAY);
  });

  it('yesterday → 昨天 00:00 ~ 今天 00:00', () => {
    const { startTs, endTs } = resolveTimeRange('yesterday', { now: NOW });
    const todayStart = startOfLocalDay(new Date(NOW));
    expect(startTs).toBe(todayStart - MS_PER_DAY);
    expect(endTs).toBe(todayStart);
  });

  it('this-week → 本周一 00:00 ~ 下周一 00:00（Monday-start）', () => {
    const { startTs, endTs } = resolveTimeRange('this-week', { now: NOW });
    expect(endTs - startTs).toBe(7 * MS_PER_DAY);
    // 起点应当是周一（本地时区）
    expect(new Date(startTs).getDay()).toBe(1);
  });

  it('last-week → 上周一 00:00 ~ 本周一 00:00', () => {
    const { startTs, endTs } = resolveTimeRange('last-week', { now: NOW });
    const thisWeek = resolveTimeRange('this-week', { now: NOW });
    expect(endTs).toBe(thisWeek.startTs);
    expect(endTs - startTs).toBe(7 * MS_PER_DAY);
    expect(new Date(startTs).getDay()).toBe(1);
  });

  it('last-7-days → now-7d ~ now（滑动窗口，不对齐 0 点）', () => {
    const { startTs, endTs } = resolveTimeRange('last-7-days', { now: NOW });
    expect(endTs).toBe(NOW);
    expect(startTs).toBe(NOW - 7 * MS_PER_DAY);
  });

  it('custom → 使用 startTs/endTs', () => {
    const { startTs, endTs } = resolveTimeRange('custom', {
      startTs: 1000,
      endTs: 2000,
      now: NOW,
    });
    expect(startTs).toBe(1000);
    expect(endTs).toBe(2000);
  });

  it('custom 缺少 startTs/endTs → 抛错', () => {
    expect(() => resolveTimeRange('custom', { now: NOW })).toThrow(/custom/);
    expect(() => resolveTimeRange('custom', { startTs: 1, now: NOW })).toThrow(
      /custom/,
    );
  });

  it('custom endTs < startTs → 抛错', () => {
    expect(() =>
      resolveTimeRange('custom', { startTs: 200, endTs: 100, now: NOW }),
    ).toThrow();
  });

  it('默认 now 为 Date.now()（无 opts 也能工作）', () => {
    const before = Date.now();
    const { startTs, endTs } = resolveTimeRange('today');
    const after = Date.now();
    // today 窗口应覆盖 [before, after]
    expect(startTs).toBeLessThanOrEqual(before);
    expect(endTs).toBeGreaterThanOrEqual(after);
  });

  // 覆盖周日（getDay()=0）的分支：JS 的 Monday-start 需要特殊处理
  it('周日基准 → this-week 仍以周一为起点', () => {
    // 2026-04-26 周日 10:00
    const sunday = new Date(2026, 3, 26, 10, 0, 0).getTime();
    const { startTs } = resolveTimeRange('this-week', { now: sunday });
    expect(new Date(startTs).getDay()).toBe(1); // 周一
    // 周一应当是 2026-04-20
    expect(new Date(startTs).getDate()).toBe(20);
  });

  it('穷尽类型：未知 timeRange 抛错', () => {
    expect(() =>
      resolveTimeRange('bogus' as unknown as TimeRangeKey, { now: NOW }),
    ).toThrow();
  });
});
