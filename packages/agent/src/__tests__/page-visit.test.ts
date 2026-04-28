/**
 * 单测：PageVisitManager
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PageVisitManager } from '../page-visit';
import type { PageVisit } from '../page-visit';
import { NullMemoryStore } from '@doc-assistant/memory';

describe('PageVisitManager', () => {
  let idCounter = 0;
  let now = 0;
  beforeEach(() => {
    idCounter = 0;
    now = 1000;
  });

  function makeManager() {
    return new PageVisitManager({
      genId: () => `v${++idCounter}`,
      getNow: () => now,
    });
  }

  it('初始无 current', () => {
    const m = makeManager();
    expect(m.getCurrent()).toBeNull();
  });

  it('startNewVisit 建立 visit 并 emit start 事件', async () => {
    const m = makeManager();
    const events: Array<{ type: string; visit: PageVisit }> = [];
    m.subscribe((e) => events.push(e));

    const v = await m.startNewVisit({
      url: 'https://react.dev/learn/hooks',
      canonicalUrl: 'https://react.dev/learn/hooks',
      articleId: 'art-1',
      title: 'React Hooks',
    });

    expect(v.visitId).toBe('v1');
    expect(v.canonicalUrl).toBe('https://react.dev/learn/hooks');
    expect(v.domain).toBe('react.dev');
    expect(v.articleId).toBe('art-1');
    expect(v.title).toBe('React Hooks');
    expect(v.startedAt).toBe(1000);
    expect(v.endedAt).toBeUndefined();

    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('start');
  });

  it('startNewVisit 已有活跃 visit 时先结束旧 visit', async () => {
    const m = makeManager();
    const events: Array<{ type: string; visit: PageVisit }> = [];
    m.subscribe((e) => events.push(e));

    await m.startNewVisit({
      url: 'https://a.com',
      canonicalUrl: 'https://a.com',
    });
    now = 2000;
    const v2 = await m.startNewVisit({
      url: 'https://b.com',
      canonicalUrl: 'https://b.com',
    });

    expect(events.map((e) => e.type)).toEqual(['start', 'end', 'start']);
    expect(v2.visitId).toBe('v2');
    expect(m.getCurrent()?.visitId).toBe('v2');
  });

  it('endCurrent 标记 endedAt 并 emit end', async () => {
    const m = makeManager();
    const events: Array<{ type: string; visit: PageVisit }> = [];
    m.subscribe((e) => events.push(e));

    await m.startNewVisit({
      url: 'https://a.com',
      canonicalUrl: 'https://a.com',
    });
    now = 5000;
    const ended = await m.endCurrent();

    expect(ended?.endedAt).toBe(5000);
    expect(events.at(-1)?.type).toBe('end');
  });

  it('endCurrent 对已结束 visit 幂等', async () => {
    const m = makeManager();
    await m.startNewVisit({
      url: 'https://a.com',
      canonicalUrl: 'https://a.com',
    });
    now = 5000;
    await m.endCurrent();
    const again = await m.endCurrent();
    expect(again?.endedAt).toBe(5000); // 不重复改 endedAt
  });

  it('onUrlChange 同 canonical 不切 visit，补充 articleId/title', async () => {
    const m = makeManager();
    await m.startNewVisit({
      url: 'https://react.dev/learn',
      canonicalUrl: 'https://react.dev/learn',
    });
    const v = await m.onUrlChange({
      url: 'https://react.dev/learn?utm=x',
      canonicalUrl: 'https://react.dev/learn',
      articleId: 'art-x',
      title: '新标题',
    });
    expect(v.visitId).toBe('v1'); // 同一 visit
    expect(v.articleId).toBe('art-x');
    expect(v.title).toBe('新标题');
  });

  it('onUrlChange canonical 变化 → 切新 visit', async () => {
    const m = makeManager();
    await m.startNewVisit({
      url: 'https://react.dev/learn',
      canonicalUrl: 'https://react.dev/learn',
    });
    const v2 = await m.onUrlChange({
      url: 'https://react.dev/reference',
      canonicalUrl: 'https://react.dev/reference',
    });
    expect(v2.visitId).toBe('v2');
  });

  it('onNewCommand 在同 URL 上强制切新 visit', async () => {
    const m = makeManager();
    await m.startNewVisit({
      url: 'https://a.com',
      canonicalUrl: 'https://a.com',
      articleId: 'x',
    });
    const v2 = await m.onNewCommand();
    expect(v2.visitId).toBe('v2');
    expect(v2.canonicalUrl).toBe('https://a.com'); // 继承
    expect(v2.articleId).toBe('x'); // 继承
  });

  it('监听异常不影响后续监听', async () => {
    const m = makeManager();
    const good = vi.fn();
    m.subscribe(() => {
      throw new Error('bad listener');
    });
    m.subscribe(good);
    await m.startNewVisit({ url: 'https://a.com', canonicalUrl: 'https://a.com' });
    expect(good).toHaveBeenCalled();
  });

  it('memory 注入：visit 开始/结束时写 page_visits', async () => {
    const recordPageVisit = vi.fn().mockResolvedValue(undefined);
    const m = new PageVisitManager({
      getNow: () => 1000,
      genId: () => 'v1',
      memory: Object.assign(new NullMemoryStore(), { recordPageVisit }),
    });
    await m.startNewVisit({ url: 'https://a.com', canonicalUrl: 'https://a.com' });
    await m.endCurrent();
    // 异步 catch 不会阻塞，等 microtask
    await Promise.resolve();
    await Promise.resolve();
    expect(recordPageVisit).toHaveBeenCalledTimes(2);
  });

  it('从 doc 读取 canonical（未提供 canonicalUrl 时）', async () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      '<html><head><link rel="canonical" href="https://react.dev/learn"></head></html>',
      'text/html',
    );
    const m = makeManager();
    const v = await m.startNewVisit({
      url: 'https://react.dev/learn?utm=x',
      doc,
    });
    expect(v.canonicalUrl).toBe('https://react.dev/learn');
  });
});
