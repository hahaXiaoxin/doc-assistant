/**
 * 单测：read_page_content 分页行为（v1.1 PR-1 · C-2）
 * ---------------------------------------------
 * - 首次调用（无 offset）应返回前若干字符 + hasMore=true + nextOffset
 * - 用 nextOffset 续读应返回剩余片段 + hasMore=false（无 nextOffset）
 * - offset 越界/负数做兜底处理
 */
import { describe, it, expect } from 'vitest';
import { readPageContentTool, type ReadPageContentResult } from '../definitions';
import { installFixture } from './_load';

function makeExecCtx(selectionText?: string) {
  return {
    meta: {
      pageContext: {
        url: 'https://example.com/long-article',
        title: 'Long Article',
        document,
        ...(selectionText ? { selectionText } : {}), // 保留:测试 helper 与生产代码语义一致(排除空字符串)
      },
    },
  };
}

/** 构造一篇"足够长"的 HTML，让 readability/semantic 能命中并产出 > 100 字的正文 */
function installLongArticle(): number {
  const paragraph =
    '这是一个足够长的正文段落，用于测试 read_page_content 的分页行为。'.repeat(
      8,
    );
  // 至少 10 段，保证截断的稳定性
  const body = Array.from({ length: 10 })
    .map((_, i) => `<p>第 ${i + 1} 段：${paragraph}</p>`)
    .join('\n');
  const html = `<!doctype html><html><head><title>Long Article</title></head><body>
    <article>
      <h1>Long Article</h1>
      ${body}
    </article>
  </body></html>`;
  installFixture(html);
  return 0;
}

describe('read_page_content · 分页 (v1.1 PR-1)', () => {
  it('首次调用返回部分内容 + hasMore=true + nextOffset', async () => {
    installLongArticle();
    const r = (await readPageContentTool.execute(
      { maxChars: 100 },
      makeExecCtx(),
    )) as ReadPageContentResult;

    expect(r.ok).toBe(true);
    expect(r.content.length).toBeLessThanOrEqual(100);
    expect(r.content.length).toBeGreaterThan(0);
    expect(r.hasMore).toBe(true);
    expect(typeof r.nextOffset).toBe('number');
    expect(r.nextOffset).toBe(r.content.length);
    expect(r.totalChars).toBeGreaterThan(r.content.length);
    expect(typeof r.title).toBe('string');
    expect(typeof r.extractor).toBe('string');
  });

  it('用 nextOffset 续读直到 hasMore=false，拼接回原文', async () => {
    installLongArticle();
    // 先全量读一次作为"期望值"
    const full = (await readPageContentTool.execute(
      { maxChars: 100_000 },
      makeExecCtx(),
    )) as ReadPageContentResult;
    expect(full.hasMore).toBe(false);
    const totalChars = full.totalChars;
    expect(totalChars).toBeGreaterThan(200);

    // 分页读取
    const chunkSize = 80;
    let offset = 0;
    let assembled = '';
    let guard = 0;
    for (;;) {
      const r = (await readPageContentTool.execute(
        { maxChars: chunkSize, offset },
        makeExecCtx(),
      )) as ReadPageContentResult;
      expect(r.ok).toBe(true);
      expect(r.totalChars).toBe(totalChars);
      assembled += r.content;
      if (!r.hasMore) {
        expect(r.nextOffset).toBeUndefined();
        break;
      }
      expect(typeof r.nextOffset).toBe('number');
      expect(r.nextOffset).toBeGreaterThan(offset);
      offset = r.nextOffset!;
      if (++guard > 200) throw new Error('分页循环未收敛');
    }
    expect(assembled).toBe(full.content);
    expect(assembled.length).toBe(totalChars);
  });

  it('offset=0 + maxChars 足够大 → 一次性读完，hasMore=false 且无 nextOffset', async () => {
    installLongArticle();
    const r = (await readPageContentTool.execute(
      { maxChars: 100_000, offset: 0 },
      makeExecCtx(),
    )) as ReadPageContentResult;
    expect(r.hasMore).toBe(false);
    expect(r.nextOffset).toBeUndefined();
    expect(r.content.length).toBe(r.totalChars);
  });

  it('offset 越界 → 返回空字符串且 hasMore=false', async () => {
    installLongArticle();
    const r = (await readPageContentTool.execute(
      { maxChars: 100, offset: 10_000_000 },
      makeExecCtx(),
    )) as ReadPageContentResult;
    expect(r.ok).toBe(true);
    expect(r.content).toBe('');
    expect(r.hasMore).toBe(false);
    expect(r.nextOffset).toBeUndefined();
  });

  it('offset 为负数 → 视为 0', async () => {
    installLongArticle();
    const fromZero = (await readPageContentTool.execute(
      { maxChars: 50, offset: 0 },
      makeExecCtx(),
    )) as ReadPageContentResult;
    const fromNeg = (await readPageContentTool.execute(
      { maxChars: 50, offset: -100 },
      makeExecCtx(),
    )) as ReadPageContentResult;
    expect(fromNeg.content).toBe(fromZero.content);
    expect(fromNeg.hasMore).toBe(fromZero.hasMore);
  });

  it('description 明确提示 hasMore=true 时应继续调用', () => {
    expect(readPageContentTool.description).toMatch(/hasMore/);
    expect(readPageContentTool.description).toMatch(/nextOffset|再次调用|分页/);
  });

  it('JSON schema 含 maxChars 与 offset', () => {
    const schema = readPageContentTool.parametersJsonSchema as {
      properties?: Record<string, unknown>;
    };
    expect(schema.properties).toBeDefined();
    expect(schema.properties!.maxChars).toBeDefined();
    expect(schema.properties!.offset).toBeDefined();
  });

  it('未提供 pageContext 时抛错（上层 loop 捕获后标 isError=true）', async () => {
    installLongArticle();
    await expect(
      readPageContentTool.execute({ maxChars: 100 }, {}),
    ).rejects.toThrow(/pageContext/);
  });
});
