/**
 * 单测：HookRegistry · OpenAI 兼容 Provider 的扩展点流水线
 * ---------------------------------------------
 * 覆盖点(契约):
 * - 基础注册 + 执行
 * - 多个同 kind hook 按 priority 升序执行
 * - 同 priority 时保持注册顺序(稳定排序)
 * - 默认 priority=undefined 等价于 0
 * - 不同 kind 互不影响
 * - hook 抛错向上传播,不被吞
 * - 空 registry 直接返回输入(身份函数)
 */
import { describe, expect, it } from 'vitest';
import { HookRegistry } from '../hooks';
import type { OpenAIChatRequest, OpenAIMessage } from '../sse-chat';
import type { ChatMessage } from '@doc-assistant/shared';
import type { ChatParams } from '../../interface';

const PARAMS: ChatParams = { messages: [] };
const BODY: OpenAIChatRequest = { model: 'm', messages: [], stream: true };
const MSG: OpenAIMessage = { role: 'user', content: 'hi' };
const SRC: ChatMessage = { role: 'user', content: 'hi' };

describe('HookRegistry · 基础注册 + 执行', () => {
  it('注册一个 request:body hook → run 后输出经过 hook 修改', () => {
    const reg = new HookRegistry();
    reg.register({
      kind: 'request:body',
      name: 'add-temp',
      fn: (b) => ({ ...b, temperature: 0.7 }),
    });
    const out = reg.runRequestBody(BODY, { params: PARAMS });
    expect(out.temperature).toBe(0.7);
    expect(out.model).toBe('m');
  });

  it('注册一个 message:outgoing hook → run 后输出经过 hook 修改', () => {
    const reg = new HookRegistry();
    reg.register({
      kind: 'message:outgoing',
      name: 'tag-content',
      fn: (m) => ({ ...m, content: `[tagged] ${m.content as string}` }),
    });
    const out = reg.runMessageOutgoing(MSG, { params: PARAMS, source: SRC });
    expect(out.content).toBe('[tagged] hi');
  });
});

describe('HookRegistry · 优先级排序', () => {
  it('多个 request:body hook 按 priority 升序执行(5 / 1 / 3 → 顺序为 1, 3, 5)', () => {
    const reg = new HookRegistry();
    const trace: number[] = [];
    reg.register({
      kind: 'request:body',
      priority: 5,
      fn: (b) => {
        trace.push(5);
        return b;
      },
    });
    reg.register({
      kind: 'request:body',
      priority: 1,
      fn: (b) => {
        trace.push(1);
        return b;
      },
    });
    reg.register({
      kind: 'request:body',
      priority: 3,
      fn: (b) => {
        trace.push(3);
        return b;
      },
    });
    reg.runRequestBody(BODY, { params: PARAMS });
    expect(trace).toEqual([1, 3, 5]);
  });

  it('同 priority 保持注册顺序(稳定排序)', () => {
    const reg = new HookRegistry();
    reg.register({
      kind: 'request:body',
      priority: 0,
      fn: (b) => ({ ...b, model: `${b.model}+a` }),
    });
    reg.register({
      kind: 'request:body',
      priority: 0,
      fn: (b) => ({ ...b, model: `${b.model}+b` }),
    });
    reg.register({
      kind: 'request:body',
      priority: 0,
      fn: (b) => ({ ...b, model: `${b.model}+c` }),
    });
    const out = reg.runRequestBody(BODY, { params: PARAMS });
    expect(out.model).toBe('m+a+b+c');
  });

  it('默认 priority(undefined)等价于 0,与显式 priority=0 互相之间也保持注册顺序', () => {
    const reg = new HookRegistry();
    const trace: string[] = [];
    reg.register({
      kind: 'request:body',
      fn: (b) => {
        trace.push('default-1');
        return b;
      },
    });
    reg.register({
      kind: 'request:body',
      priority: 0,
      fn: (b) => {
        trace.push('explicit-0');
        return b;
      },
    });
    reg.register({
      kind: 'request:body',
      fn: (b) => {
        trace.push('default-2');
        return b;
      },
    });
    // 优先级=-1 的 hook 应该最先执行
    reg.register({
      kind: 'request:body',
      priority: -1,
      fn: (b) => {
        trace.push('priority-neg-1');
        return b;
      },
    });
    reg.runRequestBody(BODY, { params: PARAMS });
    expect(trace).toEqual(['priority-neg-1', 'default-1', 'explicit-0', 'default-2']);
  });
});

describe('HookRegistry · kind 隔离', () => {
  it('注册两个不同 kind 的 hook,只有匹配 kind 的会被运行', () => {
    const reg = new HookRegistry();
    let bodyRan = 0;
    let msgRan = 0;
    reg.register({
      kind: 'request:body',
      fn: (b) => {
        bodyRan++;
        return b;
      },
    });
    reg.register({
      kind: 'message:outgoing',
      fn: (m) => {
        msgRan++;
        return m;
      },
    });
    reg.runRequestBody(BODY, { params: PARAMS });
    expect(bodyRan).toBe(1);
    expect(msgRan).toBe(0);

    reg.runMessageOutgoing(MSG, { params: PARAMS, source: SRC });
    expect(bodyRan).toBe(1);
    expect(msgRan).toBe(1);
  });
});

describe('HookRegistry · 错误传播', () => {
  it('hook 抛错向上传播,不被吞', () => {
    const reg = new HookRegistry();
    reg.register({
      kind: 'request:body',
      fn: () => {
        throw new Error('boom');
      },
    });
    expect(() => reg.runRequestBody(BODY, { params: PARAMS })).toThrow('boom');
  });

  it('message:outgoing hook 抛错也向上传播', () => {
    const reg = new HookRegistry();
    reg.register({
      kind: 'message:outgoing',
      fn: () => {
        throw new Error('boom-msg');
      },
    });
    expect(() => reg.runMessageOutgoing(MSG, { params: PARAMS, source: SRC })).toThrow(
      'boom-msg',
    );
  });
});

describe('HookRegistry · 空 registry 行为', () => {
  it('未注册任何 hook → runRequestBody 直接返回输入(身份函数)', () => {
    const reg = new HookRegistry();
    const out = reg.runRequestBody(BODY, { params: PARAMS });
    expect(out).toBe(BODY);
  });

  it('未注册任何 hook → runMessageOutgoing 直接返回输入(身份函数)', () => {
    const reg = new HookRegistry();
    const out = reg.runMessageOutgoing(MSG, { params: PARAMS, source: SRC });
    expect(out).toBe(MSG);
  });
});
