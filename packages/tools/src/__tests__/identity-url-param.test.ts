/**
 * 单测：Identity 策略（url-param / open-graph / json-ld / heading / url-fallback）
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  UrlParamStrategy,
  OpenGraphStrategy,
  JsonLdStrategy,
  HeadingStrategy,
  UrlFallbackStrategy,
} from '../page/identity';
import { loadFixture, installFixture } from './_load';

describe('UrlParamStrategy', () => {
  it('命中 id 参数生成稳定 id', () => {
    const result = UrlParamStrategy.extract({
      url: 'https://example.com/view?id=abc123&other=foo',
      title: 'Some',
      document,
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe('url-param');
    expect(result!.id).toContain('id=abc123');
  });

  it('命中 docId 参数', () => {
    const r = UrlParamStrategy.extract({
      url: 'https://docs.example.com/d?docId=D_1',
      title: '',
      document,
    });
    expect(r?.id).toContain('docId=D_1');
  });

  it('没有相关参数返回 null', () => {
    const r = UrlParamStrategy.extract({
      url: 'https://example.com/home',
      title: '',
      document,
    });
    expect(r).toBeNull();
  });
});

describe('OpenGraphStrategy', () => {
  it('读取 og:title 与 og:url', () => {
    installFixture(loadFixture('medium-article.html'));
    const r = OpenGraphStrategy.extract({
      url: 'https://medium.example.com/posts/scale-fe',
      title: '',
      document,
    });
    expect(r).not.toBeNull();
    expect(r!.title).toBe('How we scale our frontend architecture');
    expect(r!.url).toBe('https://medium.example.com/posts/scale-fe');
  });

  it('无 og:title 时返回 null', () => {
    installFixture('<html><head></head><body></body></html>');
    const r = OpenGraphStrategy.extract({
      url: 'https://example.com',
      title: '',
      document,
    });
    expect(r).toBeNull();
  });
});

describe('JsonLdStrategy', () => {
  beforeEach(() => {
    installFixture(loadFixture('medium-article.html'));
  });

  it('命中 BlogPosting 的 headline + @id', () => {
    const r = JsonLdStrategy.extract({
      url: 'https://medium.example.com/posts/scale-fe',
      title: '',
      document,
    });
    expect(r).not.toBeNull();
    expect(r!.title).toBe('How we scale our frontend architecture');
    expect(r!.id).toContain('https://medium.example.com/posts/scale-fe');
    expect(r!.source).toBe('json-ld');
  });
});

describe('HeadingStrategy', () => {
  it('取第一个 h1 + pathname', () => {
    installFixture(loadFixture('docs-qq-aio.html'));
    const r = HeadingStrategy.extract({
      url: 'https://docs.qq.com/aio/DQVdScHFtR1VtUkZo',
      title: '',
      document,
    });
    expect(r).not.toBeNull();
    expect(r!.title).toBe('一、背景');
    expect(r!.id).toContain('docs.qq.com/aio/DQVdScHFtR1VtUkZo');
  });
});

describe('UrlFallbackStrategy', () => {
  it('归一化 URL：去 fragment，排序 query', () => {
    const r = UrlFallbackStrategy.extract({
      url: 'https://example.com/a?b=2&a=1#frag',
      title: 'T',
      document,
    });
    expect(r).not.toBeNull();
    expect(r!.id).toBe('url:https://example.com/a?a=1&b=2');
  });
});
