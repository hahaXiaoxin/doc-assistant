/**
 * 单测 · SlashCommandRegistry.dispatch
 * ---------------------------------------------
 * 覆盖 v1.2 的核心契约："发送时分发" —— 输入开头匹配已注册命令时,
 * 调 cmd.execute(ctx, rawArgs) 并返回 handled,否则 passthrough 让宿主当
 * 普通消息发出。
 *
 * 这条路径取代了 v1.1 的 "pick → execute" 副作用分散,所以测试关注:
 *   1. 选中 /recall 后输入框文本是 `/recall ` → 发送应触发 recall 分发
 *   2. /<未注册命令> 不被吞掉,passthrough 给普通消息发送
 *   3. 普通消息(无 leading slash)passthrough
 *   4. 多空格 / 行首换行 / args 中带空格 都能正确解析
 */
import { describe, it, expect, vi } from 'vitest';
import { createDefaultCommandRegistry, SlashCommandRegistry } from '../registry';
import type { SlashCommand, SlashCommandContext } from '../types';

function makeCtx(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return {
    clearConversation: vi.fn(),
    closeMenu: vi.fn(),
    notify: vi.fn(),
    startNewVisit: vi.fn().mockResolvedValue(undefined),
    triggerRecall: vi.fn().mockResolvedValue(undefined),
    triggerTopicIdentify: vi.fn().mockResolvedValue(undefined),
    setSessionTopic: vi.fn().mockResolvedValue(undefined),
    appendAssistantNote: vi.fn(),
    ...overrides,
  };
}

describe('SlashCommandRegistry.dispatch', () => {
  it('「选中 /recall 后用户提交 `/recall foo bar`」→ 触发 triggerRecall("foo bar"),不当普通消息', async () => {
    const registry = createDefaultCommandRegistry();
    const triggerRecall = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ triggerRecall });
    const r = registry.dispatch('/recall foo bar', ctx);
    expect(r.handled).toBe(true);
    if (r.handled) await r.result;
    expect(triggerRecall).toHaveBeenCalledWith('foo bar');
  });

  it('「pick /recall 后立刻发送(只剩 `/recall ` 一个空格)」→ 命中分发,无 args 走 notify 用法提示', async () => {
    const registry = createDefaultCommandRegistry();
    const triggerRecall = vi.fn();
    const notify = vi.fn();
    const ctx = makeCtx({ triggerRecall, notify });
    const r = registry.dispatch('/recall ', ctx);
    expect(r.handled).toBe(true);
    if (r.handled) await r.result;
    expect(triggerRecall).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('用法'));
  });

  it('「无 leading slash 的普通消息」→ passthrough', () => {
    const registry = createDefaultCommandRegistry();
    const ctx = makeCtx();
    const r = registry.dispatch('帮我总结这一页', ctx);
    expect(r.handled).toBe(false);
    expect(ctx.notify).not.toHaveBeenCalled();
  });

  it('「未注册的 /foo」→ passthrough(允许发出 `/usr/local/...` 这类代码片段)', () => {
    const registry = createDefaultCommandRegistry();
    const ctx = makeCtx();
    const r = registry.dispatch('/usr/local/bin/ls', ctx);
    expect(r.handled).toBe(false);
  });

  it('「行首有空白」也能识别(模拟用户不小心多按了空格)', async () => {
    const registry = createDefaultCommandRegistry();
    const ctx = makeCtx();
    const r = registry.dispatch('   /new', ctx);
    expect(r.handled).toBe(true);
    if (r.handled) await r.result;
  });

  it('「/topic <args>」分发到 topic 命令 + setSessionTopic', async () => {
    const registry = createDefaultCommandRegistry();
    const setSessionTopic = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ setSessionTopic });
    const r = registry.dispatch('/topic Agent 设计', ctx);
    expect(r.handled).toBe(true);
    if (r.handled) await r.result;
    expect(setSessionTopic).toHaveBeenCalledWith('Agent 设计');
  });

  it('自定义 registry · 注册的命令同样能被 dispatch 命中', async () => {
    const customCmd: SlashCommand = {
      name: 'foo',
      description: 'test',
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const r = new SlashCommandRegistry();
    r.register(customCmd);
    const ctx = makeCtx();
    const out = r.dispatch('/foo bar baz', ctx);
    expect(out.handled).toBe(true);
    expect(customCmd.execute).toHaveBeenCalledWith(ctx, 'bar baz');
  });
});
