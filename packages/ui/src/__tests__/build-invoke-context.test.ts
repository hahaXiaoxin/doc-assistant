/**
 * 单测：buildAgentInvokeContextFragment（v1.1 PR-1 · Context 瘦身）
 *
 * 契约：把 UI 层的 PageSummary 投影为 Agent 调用片段时：
 * - **不得**包含 `summary` 字段（Context 层停止主动注入页面正文摘要）
 * - 保留 url / title / identityTitle / identityId / canonicalUrl / domain / visitId
 * - page 为 null 时返回空对象
 */
import { describe, it, expect } from 'vitest';
import { buildAgentInvokeContextFragment, type PageSummary } from '../features/chat/ChatPanel';

describe('buildAgentInvokeContextFragment · v1.1 PR-1', () => {
  it('page=null → 返回空对象', () => {
    expect(buildAgentInvokeContextFragment(null)).toEqual({});
  });

  it('完整 PageSummary → 返回的 page 对象不含 summary，其它字段保留', () => {
    const pageSummary: PageSummary = {
      url: 'https://example.com/a',
      title: 'Tab',
      identityTitle: 'Canonical',
      identityId: 'id_1',
      canonicalUrl: 'https://example.com/a',
      domain: 'example.com',
      visitId: 'v_1',
      summary: '这是一大段被 PR-1 主动去掉的正文摘要，不应该再出现在 Agent 上下文里',
      extractor: 'readability',
    };
    const out = buildAgentInvokeContextFragment(pageSummary);
    expect(out.page).toBeDefined();
    const p = out.page!;
    expect(p.url).toBe('https://example.com/a');
    expect(p.title).toBe('Tab');
    expect(p.identityTitle).toBe('Canonical');
    expect(p.identityId).toBe('id_1');
    expect(p.canonicalUrl).toBe('https://example.com/a');
    expect(p.domain).toBe('example.com');
    // 关键断言：不再透传 summary
    expect('summary' in p).toBe(false);
    // extractor 仅用于 UI PageContextCard 展示，不应进入 Agent 上下文
    expect((p as { extractor?: unknown }).extractor).toBeUndefined();
    expect(out.visitId).toBe('v_1');
  });

  it('缺省可选字段时不添加 undefined key（避免污染 ContextSource 判空）', () => {
    const pageSummary: PageSummary = {
      url: 'https://example.com/b',
      title: 'B',
    };
    const out = buildAgentInvokeContextFragment(pageSummary);
    expect(out.page).toEqual({
      url: 'https://example.com/b',
      title: 'B',
    });
    expect('visitId' in out).toBe(false);
  });
});
