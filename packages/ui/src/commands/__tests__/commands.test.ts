/**
 * 单测：Slash 命令（new / recall / topic）
 * ---------------------------------------------
 * 只测命令对 SlashCommandContext 的行为；不依赖 Lexical / React。
 */
import { describe, it, expect, vi } from 'vitest';
import { newCommand } from '../new-command';
import { recallCommand } from '../recall-command';
import { topicCommand } from '../topic-command';
import type { SlashCommandContext } from '../types';

function makeCtx(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return {
    clearConversation: vi.fn(),
    closeMenu: vi.fn(),
    notify: vi.fn(),
    // v0.3 · 5 项新增能力全部必填，默认注入 no-op mock
    startNewVisit: vi.fn().mockResolvedValue(undefined),
    triggerRecall: vi.fn().mockResolvedValue(undefined),
    triggerTopicIdentify: vi.fn().mockResolvedValue(undefined),
    setSessionTopic: vi.fn().mockResolvedValue(undefined),
    appendAssistantNote: vi.fn(),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* /new                                                               */
/* ------------------------------------------------------------------ */

describe('/new 命令', () => {
  it('无 requestClearConversation → 直接清 UI 并调用 startNewVisit', async () => {
    const startNewVisit = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ startNewVisit });
    await newCommand.execute(ctx);
    expect(ctx.clearConversation).toHaveBeenCalledTimes(1);
    expect(startNewVisit).toHaveBeenCalledTimes(1);
    expect(ctx.notify).toHaveBeenCalledWith('已开启新的会话');
    expect(ctx.closeMenu).toHaveBeenCalledTimes(1);
  });

  it('requestClearConversation → true 时走 startNewVisit;clearConversation 由宿主在 modal onConfirm 里做', async () => {
    const requestClearConversation = vi.fn().mockResolvedValue(true);
    const startNewVisit = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ requestClearConversation, startNewVisit });
    await newCommand.execute(ctx);
    expect(requestClearConversation).toHaveBeenCalledTimes(1);
    expect(ctx.clearConversation).not.toHaveBeenCalled();
    expect(startNewVisit).toHaveBeenCalledTimes(1);
    expect(ctx.notify).toHaveBeenCalledWith('已开启新的会话');
  });

  it('requestClearConversation → false(用户取消)时不触发 startNewVisit 也不 notify', async () => {
    const requestClearConversation = vi.fn().mockResolvedValue(false);
    const startNewVisit = vi.fn();
    const ctx = makeCtx({ requestClearConversation, startNewVisit });
    await newCommand.execute(ctx);
    expect(requestClearConversation).toHaveBeenCalledTimes(1);
    expect(startNewVisit).not.toHaveBeenCalled();
    expect(ctx.notify).not.toHaveBeenCalled();
    expect(ctx.closeMenu).toHaveBeenCalledTimes(1);
  });

  it('startNewVisit 抛错时 notify 错误但不中断', async () => {
    const ctx = makeCtx({
      startNewVisit: vi.fn().mockRejectedValue(new Error('boom')),
    });
    await newCommand.execute(ctx);
    expect(ctx.notify).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(ctx.closeMenu).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* /recall                                                            */
/* ------------------------------------------------------------------ */

describe('/recall 命令', () => {
  it('空 args → notify 用法提示且不调 triggerRecall', async () => {
    const triggerRecall = vi.fn();
    const ctx = makeCtx({ triggerRecall });
    await recallCommand.execute(ctx, '   ');
    expect(triggerRecall).not.toHaveBeenCalled();
    expect(ctx.notify).toHaveBeenCalledWith(expect.stringContaining('用法'));
    expect(ctx.closeMenu).toHaveBeenCalledTimes(1);
  });

  it('有 args → 调用 triggerRecall 并关闭菜单', async () => {
    const triggerRecall = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ triggerRecall });
    await recallCommand.execute(ctx, 'agent loop');
    expect(triggerRecall).toHaveBeenCalledWith('agent loop');
    expect(ctx.closeMenu).toHaveBeenCalledTimes(1);
  });

  it('triggerRecall 抛错 → notify 失败', async () => {
    const ctx = makeCtx({
      triggerRecall: vi.fn().mockRejectedValue(new Error('rag down')),
    });
    await recallCommand.execute(ctx, 'x');
    expect(ctx.notify).toHaveBeenCalledWith(expect.stringContaining('rag down'));
  });
});

/* ------------------------------------------------------------------ */
/* /topic                                                             */
/* ------------------------------------------------------------------ */

describe('/topic 命令', () => {
  it('无 args → triggerTopicIdentify', async () => {
    const triggerTopicIdentify = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ triggerTopicIdentify });
    await topicCommand.execute(ctx);
    expect(triggerTopicIdentify).toHaveBeenCalledTimes(1);
    expect(ctx.notify).toHaveBeenCalledWith('正在识别当前话题...');
    expect(ctx.notify).toHaveBeenCalledWith('话题识别完成');
  });

  it('有 args → setSessionTopic', async () => {
    const setSessionTopic = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ setSessionTopic });
    await topicCommand.execute(ctx, 'Agent 设计');
    expect(setSessionTopic).toHaveBeenCalledWith('Agent 设计');
    expect(ctx.notify).toHaveBeenCalledWith(expect.stringContaining('Agent 设计'));
  });

  it('triggerTopicIdentify 抛错 → notify 失败', async () => {
    const ctx = makeCtx({
      triggerTopicIdentify: vi.fn().mockRejectedValue(new Error('aux down')),
    });
    await topicCommand.execute(ctx);
    expect(ctx.notify).toHaveBeenCalledWith(expect.stringContaining('aux down'));
  });
});
