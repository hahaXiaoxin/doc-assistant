/**
 * 单测：PageContextSource（v1.1 PR-1 · Context 瘦身）
 *
 * 覆盖点：
 * - 只渲染身份段（标题 + URL + 文章 ID），不再渲染"## 正文摘要"段
 * - 不再渲染"摘要只是预览..."的工具使用提示
 * - 即便上游（历史代码）传了 summary，也应被忽略（AgentInvokeContext.page 已去掉该字段）
 * - ctx.page 缺失时返回 null
 */
import { describe, it, expect } from 'vitest';
import { pageContextSource } from '../context/page-context';
import type { AgentInvokeContext } from '../context';

const BASE: AgentInvokeContext = {
  userInput: 'hi',
  history: [],
};

describe('pageContextSource · v1.1 PR-1', () => {
  it('priority=80 且 name=page-context', () => {
    expect(pageContextSource.priority).toBe(80);
    expect(pageContextSource.name).toBe('page-context');
  });

  it('ctx.page 缺失 → null', async () => {
    expect(await pageContextSource.gather(BASE)).toBeNull();
  });

  it('只渲染身份段（标题 / URL / 文章 ID），不含 summary / 摘要提示', async () => {
    const seg = await pageContextSource.gather({
      ...BASE,
      page: {
        url: 'https://example.com/a',
        title: 'Tab Title',
        identityTitle: 'Canonical Title',
        identityId: 'article_001',
      },
    });
    expect(seg).not.toBeNull();
    expect(seg!.message.role).toBe('system');
    const content = String(seg!.message.content);
    expect(content).toContain('# 当前页面上下文');
    expect(content).toContain('Canonical Title');
    expect(content).toContain('https://example.com/a');
    expect(content).toContain('article_001');
    // 明确不再出现摘要段与摘要使用提示
    expect(content).not.toContain('正文摘要');
    expect(content).not.toContain('## 正文摘要');
    expect(content).not.toContain('摘要只是预览');
  });

  it('未识别身份时用 title 兜底；无 identityId 时不渲染文章 ID 行', async () => {
    const seg = await pageContextSource.gather({
      ...BASE,
      page: {
        url: 'https://example.com/b',
        title: 'Fallback Title',
      },
    });
    const content = String(seg!.message.content);
    expect(content).toContain('Fallback Title');
    expect(content).not.toContain('文章 ID');
  });

  it('即使上游偷偷塞 summary 字段（类型系统已禁），也不会出现在输出里', async () => {
    const seg = await pageContextSource.gather({
      ...BASE,
      page: {
        url: 'https://example.com/c',
        title: 'T',
        // @ts-expect-error v1.1 PR-1 已从 AgentInvokeContext.page 移除 summary 字段
        summary: '这是一段不应出现在 prompt 里的摘要',
      },
    });
    const content = String(seg!.message.content);
    expect(content).not.toContain('这是一段不应出现在 prompt 里的摘要');
    expect(content).not.toContain('正文摘要');
  });
});
