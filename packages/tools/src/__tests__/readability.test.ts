/**
 * 单测：ReadabilityExtractor
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { ReadabilityExtractor } from '../page/content/readability';
import { loadFixture, installFixture } from './_load';

function mkCtx() {
  return {
    url: 'https://medium.example.com/posts/scale-fe',
    title: document.title,
    document,
  };
}

describe('ReadabilityExtractor', () => {
  beforeEach(() => {
    installFixture(loadFixture('medium-article.html'));
  });

  it('对典型博客页能提取出主体文本与标题', () => {
    const ctx = mkCtx();
    expect(ReadabilityExtractor.canHandle(ctx)).toBe(true);
    const result = ReadabilityExtractor.extract(ctx);
    expect(result).not.toBeNull();
    expect(result!.extractor).toBe('readability');
    expect(result!.title).toContain('scale our frontend');
    expect(result!.content).toContain('Boundaries before frameworks');
    expect(result!.charCount).toBeGreaterThan(300);
  });

  it('excerpt 被截断到约 200 字以内', () => {
    const r = ReadabilityExtractor.extract(mkCtx());
    expect(r!.excerpt.length).toBeLessThanOrEqual(201); // 200 + 省略号
  });

  it('不污染原始 document（clone 生效）', () => {
    const before = document.querySelectorAll('p').length;
    ReadabilityExtractor.extract(mkCtx());
    const after = document.querySelectorAll('p').length;
    expect(after).toBe(before);
  });
});
