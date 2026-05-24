/**
 * 单测 · Slash 命令面板触发/关闭/补全机制 (v2.0)
 * ---------------------------------------------
 * 覆盖新规范的核心契约:
 *  1. 键盘按 `/` 才能打开面板; 程序化 insertText `/` 不触发
 *  2. 输入空格立刻关菜单 (空格仍作为字符插入)
 *  3. 输入 `/rec` 选 recall → 编辑器内容是 `/recall ` (不是 `/rec/recall`)
 *  4. 选中之后再按 Enter 走 SubmitPlugin (不被 pick 重复拦)
 *
 * 实现策略:
 *  - 纯函数 `extractSlashQuery` / `canOpenSlashAt` 单独契约测试
 *  - 「pick → range-replace」用真 lexical createEditor + ParagraphNode + TextNode
 *    跑一遍 update, 验证最终 textContent
 *  - 「键盘抢占 Enter」沿用 priority 测试同款手法 (CRITICAL vs HIGH 各注册一个 spy)
 */
import { describe, it, expect, vi } from 'vitest';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  createEditor,
  type RangeSelection,
} from 'lexical';
import {
  canOpenSlashAt,
  extractSlashQuery,
} from '../SlashCommandPlugin';

/* ------------------------------------------------------------------ */
/* 纯函数契约                                                          */
/* ------------------------------------------------------------------ */

describe('canOpenSlashAt · 行首 / 前空白 才允许开菜单', () => {
  it('空字符串 → 行首, 允许', () => {
    expect(canOpenSlashAt('')).toBe(true);
  });
  it('前一字符是空格 → 允许', () => {
    expect(canOpenSlashAt('hello ')).toBe(true);
  });
  it('前一字符是换行 → 允许', () => {
    expect(canOpenSlashAt('foo\n')).toBe(true);
  });
  it('前一字符是字母 → 不允许 (避免在 `/usr/local` 路径中误触发)', () => {
    expect(canOpenSlashAt('foo')).toBe(false);
  });
  it('前一字符是 `/` (路径片段) → 不允许', () => {
    expect(canOpenSlashAt('https:/')).toBe(false);
  });
});

describe('extractSlashQuery · 提取光标前 `/<token>`', () => {
  it('单独 `/` → query=`/`, offset=0', () => {
    expect(extractSlashQuery('/')).toEqual({ query: '/', triggerOffset: 0 });
  });
  it('`/rec` → query=`/rec`, offset=0', () => {
    expect(extractSlashQuery('/rec')).toEqual({ query: '/rec', triggerOffset: 0 });
  });
  it('行内 `hello /rec` (`/` 前置空格) → 命中, offset=6', () => {
    expect(extractSlashQuery('hello /rec')).toEqual({ query: '/rec', triggerOffset: 6 });
  });
  it('换行后 `/rec` → 命中', () => {
    expect(extractSlashQuery('hi\n/r')).toEqual({ query: '/r', triggerOffset: 3 });
  });
  it('`a/rec` (`/` 前是字母) → 不命中', () => {
    expect(extractSlashQuery('a/rec')).toBeNull();
  });
  it('`/rec ` (token 后跟空格) → 不命中 (空格应当让菜单关闭)', () => {
    expect(extractSlashQuery('/rec ')).toBeNull();
  });
  it('`/rec abc` (token 中含空格) → 不命中', () => {
    expect(extractSlashQuery('/rec abc')).toBeNull();
  });
  it('普通文本 → 不命中', () => {
    expect(extractSlashQuery('帮我总结')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 集成 · 真 editor 上验证 pick 的 range-replace 不再拼接 `/rec/recall` */
/* ------------------------------------------------------------------ */

function makeAttachedEditor() {
  // 用一个 div 做 root —— happy-dom 支持 contentEditable 设置, 足够 lexical 跑 update
  const div = document.createElement('div');
  div.contentEditable = 'true';
  document.body.appendChild(div);
  const editor = createEditor({
    namespace: 'slash-trigger-test',
    nodes: [],
    onError: (e) => {
      throw e;
    },
  });
  editor.setRootElement(div);
  return { editor, div };
}

describe('SlashCommandPlugin · pick 自动补全 · range-replace 不拼接', () => {
  it('输入 `/rec` 选中 recall → 编辑器内容是 `/recall `, 不是 `/rec/recall`', async () => {
    const { editor } = makeAttachedEditor();

    // 在同一个 update 里完成 setup + pick, 避免 happy-dom 下 editor 状态在
    // 多次 update 之间被异步 reconciler 抹掉; { discrete: true } 强制同步刷新。
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const para = $createParagraphNode();
        const text = $createTextNode('/rec');
        para.append(text);
        root.append(para);
        // 模拟「光标在 /rec 末尾, trigger 在 0」
        text.select(0, 4);
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        (sel as RangeSelection).setTextNodeRange(text, 0, text, 4);
        (sel as unknown as { insertText: (s: string) => void }).insertText('/recall ');
      },
      { discrete: true },
    );

    let finalText = '';
    editor.getEditorState().read(() => {
      finalText = $getRoot().getTextContent();
    });
    expect(finalText).toBe('/recall ');
    expect(finalText).not.toContain('/rec/recall');
  });

  it('输入 `hello /n` 选中 new → 输入框变成 `hello /new ` (前文保留)', () => {
    const { editor } = makeAttachedEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const para = $createParagraphNode();
        const text = $createTextNode('hello /n');
        para.append(text);
        root.append(para);
        text.select(6, 8);
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        // `/` 在 offset=6, cursor 在 offset=8
        (sel as RangeSelection).setTextNodeRange(text, 6, text, 8);
        (sel as unknown as { insertText: (s: string) => void }).insertText('/new ');
      },
      { discrete: true },
    );

    let finalText = '';
    editor.getEditorState().read(() => {
      finalText = $getRoot().getTextContent();
    });
    expect(finalText).toBe('hello /new ');
  });
});

/* ------------------------------------------------------------------ */
/* 集成 · pick 之后第二次 Enter 走 SubmitPlugin (不被 pick 重复拦截)     */
/* ------------------------------------------------------------------ */

describe('SlashCommandPlugin · pick 之后 Enter 走 submit', () => {
  it('菜单打开 → Enter 触发 pick (CRITICAL 抢占); pick 后菜单关 → 再按 Enter 落到 SubmitPlugin', () => {
    const editor = createEditor({
      namespace: 'slash-trigger-enter',
      onError: (e) => {
        throw e;
      },
    });

    let menuOpen = false;
    const submit = vi.fn(() => true);
    const slashPick = vi.fn(() => {
      if (!menuOpen) return false;
      // 模拟 pickCommand: 同步关菜单
      menuOpen = false;
      return true;
    });

    // 注册顺序复刻真实 JSX: SubmitPlugin 先, SlashCommandPlugin 后
    editor.registerCommand(KEY_ENTER_COMMAND, submit, COMMAND_PRIORITY_HIGH);
    editor.registerCommand(KEY_ENTER_COMMAND, slashPick, COMMAND_PRIORITY_CRITICAL);

    // 步骤 1: 用户按 `/` (在新规范下由 KEY_DOWN_COMMAND 打开 —— 这里直接置位)
    menuOpen = true;

    // 步骤 2: Enter pick
    const handled1 = editor.dispatchCommand(
      KEY_ENTER_COMMAND,
      new KeyboardEvent('keydown', { key: 'Enter' }),
    );
    expect(handled1).toBe(true);
    expect(slashPick).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    expect(menuOpen).toBe(false);

    // 步骤 3: 紧接着第二次 Enter, 期望发送
    const handled2 = editor.dispatchCommand(
      KEY_ENTER_COMMAND,
      new KeyboardEvent('keydown', { key: 'Enter' }),
    );
    expect(handled2).toBe(true);
    expect(slashPick).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* 行为 · 程序化 insertText 不应触发菜单                                */
/* ------------------------------------------------------------------ */

/**
 * 我们无法在 happy-dom 下完整跑 React 树, 但可以验证一个关键不变量:
 *
 *   `editor.update` 写入 `/` 不会派发 KEY_DOWN_COMMAND。
 *
 * 由于新规范下 open 状态机的唯一开门钥匙是 KEY_DOWN_COMMAND, 这条不变量
 * 等价于「程序化插入 `/` 不会开菜单」, 也等价于「paste 不会开菜单」(paste
 * 走 PASTE_COMMAND 链路, 同样不派发 KEY_DOWN_COMMAND)。
 */
describe('SlashCommandPlugin · 程序化 insertText `/` 不应派发 KEY_DOWN_COMMAND', () => {
  it('editor.update 里 insertText `/` 不会让 KEY_DOWN_COMMAND 监听器收到事件', () => {
    const { editor } = makeAttachedEditor();
    const onKeyDown = vi.fn(() => false);
    // 用 KEY_DOWN_COMMAND 直接监听 —— 模拟 SlashCommandPlugin 那头
    // (注: 此测试只验证「不派发」, 不依赖优先级)
    const off = editor.registerCommand(
      KEY_DOWN_COMMAND,
      onKeyDown,
      COMMAND_PRIORITY_HIGH,
    );

    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const para = $createParagraphNode();
      const text = $createTextNode('');
      para.append(text);
      root.append(para);
      text.select(0, 0);
      const sel = $getSelection();
      if ($isRangeSelection(sel)) {
        (sel as unknown as { insertText: (s: string) => void }).insertText('/');
      }
    });

    expect(onKeyDown).not.toHaveBeenCalled();
    off();
  });
});
