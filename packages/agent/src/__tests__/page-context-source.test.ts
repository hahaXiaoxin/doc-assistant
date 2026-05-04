/**
 * 单测：v1.1 PR-2 C6 · 彻底移除 page 身份段 system 注入
 *
 * 背景：
 * - PR-1 时 PageContextSource 降级为"只渲染身份段（标题 / URL / 文章 ID）"。
 * - PR-2 C6 最终决策：LLM 不再需要任何"当前页面"的 system 段；
 *   URL / title / identityId 仅保留在系统内部（`ToolExecutionContext.meta.pageContext`），
 *   主模型如需页面正文，自行调 `read_page_content` 工具。
 * - 因此 `pageContextSource` 与 `page-context.ts` 整个被删除。
 *
 * 本测试作为回归护栏：
 * - 断言默认 Phase2 / MVP Source 组合里不再出现 name = 'page-context' 的 Source；
 * - 断言 @doc-assistant/agent 入口不再导出 `pageContextSource`。
 */
import { describe, it, expect } from 'vitest';
import {
  buildDefaultMVPSources,
  buildDefaultPhase2_0Sources,
  buildDefaultPhase2_1Sources,
} from '../context';
import { NullMemoryStore } from '@doc-assistant/memory';
import * as agentEntry from '../index';

describe('PR-2 C6 · page 身份段 system 注入已彻底移除', () => {
  const baseOpts = {
    systemPrompt: 'you are a helpful assistant',
    maxHistoryChars: 2000,
    memory: new NullMemoryStore(),
  };

  it('buildDefaultMVPSources 不再包含 page-context Source', () => {
    const names = buildDefaultMVPSources(baseOpts).map((s) => s.name);
    expect(names).not.toContain('page-context');
  });

  it('buildDefaultPhase2_0Sources 不再包含 page-context Source', () => {
    const names = buildDefaultPhase2_0Sources(baseOpts).map((s) => s.name);
    expect(names).not.toContain('page-context');
  });

  it('buildDefaultPhase2_1Sources 不再包含 page-context Source', () => {
    const names = buildDefaultPhase2_1Sources(baseOpts).map((s) => s.name);
    expect(names).not.toContain('page-context');
  });

  it('@doc-assistant/agent 入口不再导出 pageContextSource', () => {
    expect((agentEntry as Record<string, unknown>).pageContextSource).toBeUndefined();
  });
});
