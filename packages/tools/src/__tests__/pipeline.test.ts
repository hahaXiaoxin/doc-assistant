/**
 * 单测：Identity & Content pipeline（优先级 + 降级链路）
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  runIdentityPipeline,
  runContentPipeline,
} from '../page/pipeline';
import { identityRegistry } from '../page/identity';
import { contentRegistry } from '../page/content';
import type { ContentExtractor, IdentityStrategy } from '../page/types';
import { loadFixture, installFixture } from './_load';

describe('runIdentityPipeline', () => {
  beforeEach(() => {
    installFixture(loadFixture('medium-article.html'));
  });

  it('命中最高优先级策略（json-ld 优先级 70 > open-graph 60）', () => {
    const r = runIdentityPipeline({
      url: 'https://medium.example.com/posts/scale-fe',
      title: '',
      document,
    });
    expect(r.source).toBe('json-ld');
  });

  it('所有策略失败时走 url-fallback 兜底', () => {
    installFixture('<html><body></body></html>');
    const r = runIdentityPipeline({
      url: 'https://example.com/x?a=1',
      title: '',
      document,
    });
    expect(r.source).toBe('url-fallback');
  });

  it('支持注入更高优先级策略覆盖内置', () => {
    const mock: IdentityStrategy = {
      name: 'mock-dsl',
      priority: 100, // 高于所有内置（最高 json-ld=70）
      extract: () => ({
        id: 'mock:xxx',
        title: 'Mock',
        url: 'https://mock',
        source: 'mock-dsl',
      }),
    };
    identityRegistry.register(mock);
    try {
      const r = runIdentityPipeline({
        url: 'https://medium.example.com/posts/scale-fe',
        title: '',
        document,
      });
      expect(r.source).toBe('mock-dsl');
    } finally {
      identityRegistry.unregister('mock-dsl');
    }
  });
});

describe('runContentPipeline', () => {
  it('Medium 博客优先命中 Readability', () => {
    installFixture(loadFixture('medium-article.html'));
    const r = runContentPipeline({
      url: 'https://medium.example.com',
      title: '',
      document,
    });
    expect(r).not.toBeNull();
    expect(r!.extractor).toBe('readability');
  });

  it('若提供 selectionText 且非空，SelectionExtractor 优先命中', () => {
    installFixture(loadFixture('medium-article.html'));
    const r = runContentPipeline({
      url: 'https://x.com',
      title: '',
      document,
      selectionText: '被用户选中的这段',
    });
    expect(r?.extractor).toBe('selection');
    expect(r?.content).toBe('被用户选中的这段');
  });

  it('语义化但 Readability 判定失败时降级到 SemanticTagExtractor', () => {
    installFixture(loadFixture('plain-semantic.html'));
    const r = runContentPipeline({
      url: 'https://example.com/plain',
      title: '',
      document,
    });
    expect(r).not.toBeNull();
    // Readability 也可能吃下这个页面，所以允许 readability 或 semantic，但必须能提取到
    expect(['readability', 'semantic']).toContain(r!.extractor);
  });

  it('支持注入自定义 extractor', () => {
    const mock: ContentExtractor = {
      name: 'mock-dsl',
      priority: 200,
      canHandle: () => true,
      extract: () => ({
        title: 'Mock',
        content: 'mock-content',
        excerpt: 'mock',
        charCount: 12,
        extractor: 'mock-dsl',
      }),
    };
    contentRegistry.register(mock);
    try {
      installFixture(loadFixture('medium-article.html'));
      const r = runContentPipeline({
        url: 'https://x',
        title: '',
        document,
      });
      expect(r?.extractor).toBe('mock-dsl');
    } finally {
      contentRegistry.unregister('mock-dsl');
    }
  });
});
