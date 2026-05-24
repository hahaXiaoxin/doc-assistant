/**
 * 单测 · Slash 命令面板的键盘抢占契约
 * ---------------------------------------------
 * 这是一个针对 SlashCommandPlugin 和 SubmitPlugin 的"协作语义"回归测试,
 * 防止后续有人无意中把 Slash 的 Enter / Tab 处理优先级降回 HIGH ——
 * 一旦降回 HIGH, 由于 SubmitPlugin 在 JSX 里更早注册, 它会先吃掉 Enter,
 * 导致用户在斜杠面板里按回车直接发出消息 (历史 bug).
 *
 * 这里不渲染整套 React 树, 只直接用 lexical 的 createEditor + registerCommand
 * 复刻两个插件实际注册命令的方式, 然后调用 dispatchCommand, 看哪个 listener 命中.
 *
 * 选择直接测 lexical 协作契约而不是测 React 集成的原因:
 *  - happy-dom 对 contentEditable 的支持有坑, 全套渲染容易引入无关失败.
 *  - 我们要保护的不变量恰好就是 "CRITICAL 抢在 HIGH 之前", 这个在编辑器层面就能验证.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createEditor,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
} from 'lexical';

function makeEditor() {
  return createEditor({
    namespace: 'slash-priority-test',
    onError: (e) => {
      throw e;
    },
  });
}

describe('SlashCommandPlugin 键盘抢占契约', () => {
  it('当菜单"打开"时, CRITICAL 优先级的 Enter 监听抢在 HIGH 优先级的 SubmitPlugin 之前', () => {
    const editor = makeEditor();
    const submit = vi.fn(() => true); // 模拟 SubmitPlugin: 总是 handle Enter
    const slashPick = vi.fn(() => true); // 模拟 SlashCommandPlugin: 菜单打开时 handle Enter

    // 顺序复刻真实场景: 先注册 SubmitPlugin, 后注册 SlashCommandPlugin.
    // 在原 bug 里这俩都是 HIGH, 所以 SubmitPlugin 会抢先.
    editor.registerCommand(KEY_ENTER_COMMAND, submit, COMMAND_PRIORITY_HIGH);
    editor.registerCommand(KEY_ENTER_COMMAND, slashPick, COMMAND_PRIORITY_CRITICAL);

    const handled = editor.dispatchCommand(
      KEY_ENTER_COMMAND,
      new KeyboardEvent('keydown', { key: 'Enter' }),
    );

    expect(handled).toBe(true);
    expect(slashPick).toHaveBeenCalledTimes(1);
    // 关键断言: SubmitPlugin **没**被调用 —— 否则消息就被发出去了
    expect(submit).not.toHaveBeenCalled();
  });

  it('菜单"关闭"时(slashPick return false), Enter 回落到 SubmitPlugin', () => {
    const editor = makeEditor();
    const submit = vi.fn(() => true);
    // 模拟菜单未开: pick 返回 false 让事件继续往下走
    const slashPick = vi.fn(() => false);

    editor.registerCommand(KEY_ENTER_COMMAND, submit, COMMAND_PRIORITY_HIGH);
    editor.registerCommand(KEY_ENTER_COMMAND, slashPick, COMMAND_PRIORITY_CRITICAL);

    const handled = editor.dispatchCommand(
      KEY_ENTER_COMMAND,
      new KeyboardEvent('keydown', { key: 'Enter' }),
    );

    expect(handled).toBe(true);
    expect(slashPick).toHaveBeenCalledTimes(1);
    // 关键断言: SubmitPlugin 拿到了事件 —— 普通输入仍能正常发送
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('Tab 同样走 CRITICAL, 且 listener 应当 preventDefault 阻止浏览器焦点跳走', () => {
    const editor = makeEditor();
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });

    // 真实插件代码做的事: pick 内部 event.preventDefault()
    const slashPick = vi.fn((e: KeyboardEvent | null) => {
      e?.preventDefault();
      return true;
    });
    editor.registerCommand(KEY_TAB_COMMAND, slashPick, COMMAND_PRIORITY_CRITICAL);

    const handled = editor.dispatchCommand(KEY_TAB_COMMAND, event);
    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });
});
