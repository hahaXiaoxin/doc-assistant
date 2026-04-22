import { describe, it, expect } from 'vitest';
import {
  normalizeUrlString,
  readCanonicalFromDocument,
  canonicalizeUrl,
  extractDomain,
} from '../url-normalize';

describe('normalizeUrlString', () => {
  it('去掉 UTM 家族参数', () => {
    const input = 'https://react.dev/learn?utm_source=twitter&utm_medium=social&utm_campaign=x';
    expect(normalizeUrlString(input)).toBe('https://react.dev/learn');
  });

  it('去掉 fbclid/gclid 等常见追踪参数', () => {
    const input = 'https://example.com/a?fbclid=abc&gclid=def&real=keep';
    expect(normalizeUrlString(input)).toBe('https://example.com/a?real=keep');
  });

  it('保留非追踪参数', () => {
    const input = 'https://docs.qq.com/doc?id=123&mode=edit';
    expect(normalizeUrlString(input)).toBe('https://docs.qq.com/doc?id=123&mode=edit');
  });

  it('去 hash 锚点', () => {
    const input = 'https://react.dev/learn#hooks';
    expect(normalizeUrlString(input)).toBe('https://react.dev/learn');
  });

  it('去结尾斜杠但保留根路径', () => {
    expect(normalizeUrlString('https://react.dev/learn/')).toBe('https://react.dev/learn');
    expect(normalizeUrlString('https://react.dev/')).toBe('https://react.dev/');
  });

  it('同时剥离 UTM + 去 hash + 去结尾斜杠', () => {
    const input = 'https://react.dev/learn/?utm_source=x&fbclid=y#step-1';
    expect(normalizeUrlString(input)).toBe('https://react.dev/learn');
  });

  it('大小写不敏感地识别 UTM 参数', () => {
    const input = 'https://example.com/?UTM_SOURCE=x&Fbclid=y';
    expect(normalizeUrlString(input)).toBe('https://example.com/');
  });

  it('非法 URL 原样返回', () => {
    expect(normalizeUrlString('not-a-url')).toBe('not-a-url');
    expect(normalizeUrlString('')).toBe('');
  });

  it('空/undefined 兼容', () => {
    // @ts-expect-error 运行时容错
    expect(normalizeUrlString(undefined)).toBe('');
    // @ts-expect-error 运行时容错
    expect(normalizeUrlString(null)).toBe('');
  });

  it('不影响端口号的 URL', () => {
    expect(normalizeUrlString('http://localhost:3000/abc?utm_source=x')).toBe(
      'http://localhost:3000/abc',
    );
  });
});

describe('readCanonicalFromDocument', () => {
  const makeDoc = (html: string, href = 'https://original.com/page'): Document => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<html><head>${html}</head><body></body></html>`, 'text/html');
    // 模拟 location
    Object.defineProperty(doc, 'URL', { value: href, configurable: true });
    return doc;
  };

  it('读 <link rel="canonical">', () => {
    const doc = makeDoc('<link rel="canonical" href="https://react.dev/learn">');
    expect(readCanonicalFromDocument(doc)).toBe('https://react.dev/learn');
  });

  it('退化到 og:url', () => {
    const doc = makeDoc('<meta property="og:url" content="https://react.dev/og">');
    expect(readCanonicalFromDocument(doc)).toBe('https://react.dev/og');
  });

  it('再退化到 twitter:url', () => {
    const doc = makeDoc('<meta name="twitter:url" content="https://react.dev/tw">');
    expect(readCanonicalFromDocument(doc)).toBe('https://react.dev/tw');
  });

  it('canonical 优先级高于 og 和 twitter', () => {
    const doc = makeDoc(
      '<link rel="canonical" href="https://a.com/x">' +
        '<meta property="og:url" content="https://b.com/y">' +
        '<meta name="twitter:url" content="https://c.com/z">',
    );
    expect(readCanonicalFromDocument(doc)).toBe('https://a.com/x');
  });

  it('空文档或无 meta 时返回 null', () => {
    const doc = makeDoc('');
    expect(readCanonicalFromDocument(doc)).toBeNull();
  });

  it('null 文档直接返回 null', () => {
    expect(readCanonicalFromDocument(null)).toBeNull();
    expect(readCanonicalFromDocument(undefined)).toBeNull();
  });
});

describe('canonicalizeUrl', () => {
  it('doc 有 canonical 时优先用 canonical 并做归一化', () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      '<html><head><link rel="canonical" href="https://react.dev/learn/?utm_source=x"></head></html>',
      'text/html',
    );
    expect(canonicalizeUrl(doc, 'https://ignored.com/')).toBe('https://react.dev/learn');
  });

  it('doc 无 canonical 时退回 fallbackUrl', () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString('<html><head></head></html>', 'text/html');
    expect(canonicalizeUrl(doc, 'https://ex.com/a?utm_source=z#hash')).toBe('https://ex.com/a');
  });

  it('doc 为 null 时走 fallbackUrl', () => {
    expect(canonicalizeUrl(null, 'https://ex.com/a?fbclid=abc')).toBe('https://ex.com/a');
  });
});

describe('extractDomain', () => {
  it('提取 hostname', () => {
    expect(extractDomain('https://react.dev/learn')).toBe('react.dev');
    expect(extractDomain('http://localhost:3000/abc')).toBe('localhost');
  });

  it('非法 URL 返回空串', () => {
    expect(extractDomain('not-a-url')).toBe('');
  });
});
