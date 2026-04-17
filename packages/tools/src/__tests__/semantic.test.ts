/**
 * 单测：SemanticTagExtractor
 */
import { describe, expect, it } from 'vitest';
import { SemanticTagExtractor } from '../page/content/semantic';
import { loadFixture, installFixture } from './_load';

describe('SemanticTagExtractor', () => {
  it('对含 <article> 的语义化页面能提取主体', () => {
    installFixture(loadFixture('plain-semantic.html'));
    const ctx = {
      url: 'https://example.com/post',
      title: document.title,
      document,
    };
    expect(SemanticTagExtractor.canHandle(ctx)).toBe(true);
    const r = SemanticTagExtractor.extract(ctx);
    expect(r).not.toBeNull();
    expect(r!.extractor).toBe('semantic');
    expect(r!.content).toContain('semantic example');
    expect(r!.content).not.toContain('Nav menu here');
    expect(r!.content).not.toContain('Footer content');
  });

  it('对含 <main class="doc-body"> 的腾讯文档样本能提取正文', () => {
    installFixture(loadFixture('docs-qq-aio.html'));
    const ctx = {
      url: 'https://docs.qq.com/aio/xxx',
      title: document.title,
      document,
    };
    expect(SemanticTagExtractor.canHandle(ctx)).toBe(true);
    const r = SemanticTagExtractor.extract(ctx);
    expect(r).not.toBeNull();
    expect(r!.content).toContain('一、背景');
    expect(r!.content).toContain('IndexedDB');
    // 评论区属于 <div class="comments"> 不在 main 内
    expect(r!.content).not.toContain('评论');
  });

  it('无语义化标签时 canHandle=false', () => {
    installFixture('<html><body><div>just a div</div></body></html>');
    const ctx = {
      url: 'https://x.com',
      title: '',
      document,
    };
    expect(SemanticTagExtractor.canHandle(ctx)).toBe(false);
  });
});
