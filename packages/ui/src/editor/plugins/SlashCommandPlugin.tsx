/**
 * SlashCommandPlugin · `/` 触发命令面板
 * ---------------------------------------------
 * v2.0 重构 · 显式 open 状态机
 *
 * 痛点(v1.x 旧实现):
 *  - open 派生自 updateListener 里对光标前文本的正则匹配 → 编辑器内只要文本以
 *    `/` 开头就持续 open。表现:
 *    1) 程序化 insertText('/...') / 粘贴含 `/` 都会误开。
 *    2) pick 之后写入 `/<cmd> `,文本仍以 `/` 开头 → listener 反复重开,需要
 *       靠一层 `pickedPrefixRef` 抑制窗口打补丁。
 *    3) 用户输入空格本应"算了不要命令了",但只要文本仍能正则到 `/<cmd>(args)?$`
 *       菜单就关不掉。
 *
 * 新规范:
 *  1) **只有键盘按下 `/` 字符**才能打开面板(KEY_DOWN_COMMAND, 程序化 insertText
 *     和 paste 都不会派发 KEY_DOWN_COMMAND, 自然过滤掉)。
 *  2) 输入空格 → 立刻关闭面板(空格仍作为字符插入, 不 preventDefault)。
 *  3) Esc / Enter (pick) / Tab (pick) 关闭面板。
 *  4) updateListener 仅在 `open === true` 时工作: 跟踪光标 → 更新 query / 坐标;
 *     若光标移出当前 `/<token>` token (token 不再以 `/` 开头, 或被空白隔开) 则关闭。
 *     `open === false` 时直接 return。
 *  5) pick 是「自动补全」: 把当前 query token (从 triggerStart 到光标) 整段 range-replace
 *     为 `/<cmd> `。修了 v1.x 的 `/rec` → `/rec/recall` 拼接 bug。
 *
 * 与 SubmitPlugin 的协作不变:
 *  - Enter / Tab 在「菜单打开」时由本插件 CRITICAL 优先级抢占 → pick 候选 + 关菜单;
 *    菜单关时 listener 返回 false, 事件回落给 HIGH 优先级的 SubmitPlugin → 发消息。
 *  - 命令真正的副作用分发在 LexicalChatInput.handleSubmit → registry.dispatch,
 *    本插件不再触发 cmd.execute。
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  $getNodeByKey,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  KEY_ENTER_COMMAND,
  type RangeSelection,
} from 'lexical';
import { createLogger } from '@doc-assistant/shared';
import { CommandMenu } from '../../components/CommandMenu';
import type { SlashCommand } from '../../commands/types';
import type { SlashCommandRegistry } from '../../commands/registry';

const logger = createLogger('ui:slash-command');

export interface SlashCommandPluginProps {
  registry: SlashCommandRegistry;
}

interface MenuState {
  open: boolean;
  /** 当前 token, 形如 `/rec` (始终以 `/` 开头, 不含空白) */
  query: string;
  /** 菜单锚点视口坐标: x → CSS `left`, bottom → CSS `bottom`(距视口底部) */
  x: number;
  bottom: number;
  /** `/` 在文本节点中的位置, pick 时 range-replace 起点 */
  triggerStart?: { nodeKey: string; offset: number };
}

/**
 * 「光标前文本中的当前 `/` token」提取器(纯函数, 便于单测)。
 *
 * 规则:
 *  - 找到光标前最后一个 `/`, 且它必须在行首或前一字符为空白(否则 `a/rec` 这种
 *    路径片段就误判为命令)。
 *  - 从该 `/` 到光标末尾不能有空白(空格出现就关菜单, 此函数返回 null)。
 *
 * 返回 token 字符串(以 `/` 开头)和 `/` 在原 before 里的偏移; 不命中返回 null。
 */
export function extractSlashQuery(
  before: string,
): { query: string; triggerOffset: number } | null {
  // (^|\s) 锚定 `/` 在行首或前置空白; (\/[^\s]*) token 不含空白; $ 光标紧贴 token 末尾
  const m = /(^|\s)(\/[^\s]*)$/.exec(before);
  if (!m) return null;
  const token = m[2] ?? '';
  if (!token.startsWith('/')) return null;
  const triggerOffset = before.length - token.length;
  return { query: token, triggerOffset };
}

/**
 * 「按下 `/` 时光标位置是否合法」判定(纯函数)。
 *
 * - 行首 ✓
 * - 前一字符是空白(空格 / 换行 / Tab) ✓
 * - 否则 ✗ (避免在 `https://`、`/usr/local/` 这类路径中误触发)
 *
 * 注意: 调用方传的 `before` 是 keydown **当时** 光标前的文本, 此时 `/` 还没插入。
 */
export function canOpenSlashAt(before: string): boolean {
  if (before.length === 0) return true;
  const last = before.charAt(before.length - 1);
  return /\s/.test(last);
}

export function SlashCommandPlugin({ registry }: SlashCommandPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<MenuState>({
    open: false,
    query: '',
    x: 0,
    bottom: 0,
  });
  const [activeIdx, setActiveIdx] = useState(0);

  /**
   * `state.open` 的 ref 镜像。
   *
   * 解决两类竞态:
   *  1) updateListener 闭包捕获 state, 在「pick → editor.update → updateListener」
   *     这一帧里, listener 看到的 state.open 仍是 true(setState 还没生效),
   *     会把刚被 pick 替换掉的文本重新解析、覆盖 state.query。改用 ref 实时写入。
   *  2) 命令注册的 effect 依赖 state.open 重建 listener, 但 KEY_DOWN_COMMAND 的
   *     listener 我们希望只注册一次 → 也通过 ref 读最新 open。
   */
  const openRef = useRef(false);
  /** state.triggerStart 的 ref 镜像, 同样为了避免 pick 闭包捕获到旧值。 */
  const triggerRef = useRef<MenuState['triggerStart']>(undefined);

  const close = useCallback(() => {
    openRef.current = false;
    triggerRef.current = undefined;
    setState({ open: false, query: '', x: 0, bottom: 0 });
    setActiveIdx(0);
  }, []);

  const filtered = useMemo(() => {
    if (!state.query) return registry.list();
    const withoutSlash = state.query.slice(1);
    return registry.query(withoutSlash);
  }, [registry, state.query]);

  /**
   * 计算菜单在视口里的锚点坐标。锚点取「输入框外层(#chat-input-outer 或 root)」的
   * 顶边和左边, 这样无论用户输入到第几行, 菜单都贴在输入框上方而不是跟着光标乱跳。
   */
  const computeAnchor = useCallback((): { x: number; bottom: number } => {
    const root = editor.getRootElement();
    let outer: HTMLElement | null = root;
    while (outer) {
      if (outer.id === 'chat-input-outer') break;
      outer = outer.parentElement;
    }
    const rect = (outer ?? root)?.getBoundingClientRect();
    const MENU_W = 320;
    const EDGE = 8;
    const anchorLeft = rect?.left ?? 0;
    const anchorTop = rect?.top ?? 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = anchorLeft;
    if (x + MENU_W > vw - EDGE) x = vw - EDGE - MENU_W;
    if (x < EDGE) x = EDGE;
    const bottom = vh - anchorTop;
    return { x, bottom };
  }, [editor]);

  /* ------------------------------------------------------------------ */
  /* keydown · 唯一开/关 open 的入口                                     */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        // (1) 空格关菜单, 但不吞事件 —— 让空格继续被插入到编辑器
        if (event.key === ' ' && openRef.current) {
          close();
          return false;
        }

        // (2) `/` 触发开菜单 —— 仅在「行首 / 前空白」位置, 防止误触发路径片段
        //     注意此时 `/` 还没被 Lexical 插入, 我们读的是 keydown 当时的光标前文本。
        if (event.key === '/' && !openRef.current) {
          let shouldOpen = false;
          let trigger: { nodeKey: string; offset: number } | undefined;
          editor.getEditorState().read(() => {
            const sel = $getSelection();
            if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
            const node = sel.anchor.getNode();
            if (!$isTextNode(node) && sel.anchor.type !== 'text') {
              // 空 paragraph 也算行首 ——
              shouldOpen = true;
              return;
            }
            const text = node.getTextContent();
            const before = text.slice(0, sel.anchor.offset);
            if (canOpenSlashAt(before)) {
              shouldOpen = true;
              // `/` 即将被插入到 anchor.offset 位置, 所以 triggerStart === anchor.offset
              trigger = { nodeKey: node.getKey(), offset: sel.anchor.offset };
            }
          });
          if (shouldOpen) {
            const { x, bottom } = computeAnchor();
            openRef.current = true;
            triggerRef.current = trigger;
            // 默认 query='/' —— Lexical 把 `/` 插入后, updateListener 会重新计算并修正
            setState({ open: true, query: '/', x, bottom, ...(trigger ? { triggerStart: trigger } : {}) });
            setActiveIdx(0);
            logger.debug('keydown `/` → open menu', { trigger });
          }
          // 不 preventDefault, 让 `/` 继续被 Lexical 插入
          return false;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, close, computeAnchor]);

  /* ------------------------------------------------------------------ */
  /* updateListener · open 期间跟踪 query / 坐标 / 边界关闭               */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      // 关键: open=false 时直接 return, 不再做任何文本驱动的派生 →
      // 程序化 insertText / paste 一律打不开菜单。
      if (!openRef.current) return;
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) {
          close();
          return;
        }
        const anchor = sel.anchor;
        const node = anchor.getNode();
        const text = node.getTextContent();
        const before = text.slice(0, anchor.offset);
        const extracted = extractSlashQuery(before);
        if (!extracted) {
          // 光标不再处于 `/<token>` 上下文(token 被空白破坏 / 用户退到 `/` 之前) → 关
          close();
          return;
        }
        const trigger = { nodeKey: node.getKey(), offset: extracted.triggerOffset };
        triggerRef.current = trigger;
        const { x, bottom } = computeAnchor();
        setState((s) => {
          // 浅 diff 避免无意义重渲染
          if (
            s.open &&
            s.query === extracted.query &&
            s.x === x &&
            s.bottom === bottom &&
            s.triggerStart?.nodeKey === trigger.nodeKey &&
            s.triggerStart?.offset === trigger.offset
          ) {
            return s;
          }
          return { open: true, query: extracted.query, x, bottom, triggerStart: trigger };
        });
        setActiveIdx((i) => i); // 保持高亮
      });
    });
  }, [editor, close, computeAnchor]);

  /* ------------------------------------------------------------------ */
  /* 键盘导航 · ↑↓ 选择, Tab/Enter pick, Esc 关                          */
  /*                                                                    */
  /* CRITICAL 优先级抢在 HIGH 优先级的 SubmitPlugin 之前(否则菜单打开时   */
  /* 按 Enter 会先把当前文本作为消息发出去 —— 见 slash-command-priority   */
  /* 单测)。                                                             */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const off1 = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        if (!state.open) return false;
        event?.preventDefault();
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const off2 = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        if (!state.open) return false;
        event?.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const off3 = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (!state.open) return false;
        close();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const pick = (event: KeyboardEvent | null) => {
      if (!state.open) return false;
      const cmd = filtered[activeIdx];
      if (!cmd) return false;
      // Enter: 阻止换行 / 表单提交; Tab: 阻止焦点跳走
      event?.preventDefault();
      event?.stopPropagation();
      pickCommand(cmd);
      return true;
    };
    const off4 = editor.registerCommand(KEY_ENTER_COMMAND, pick, COMMAND_PRIORITY_CRITICAL);
    const off5 = editor.registerCommand(KEY_TAB_COMMAND, pick, COMMAND_PRIORITY_CRITICAL);
    return () => {
      off1();
      off2();
      off3();
      off4();
      off5();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, state.open, filtered, activeIdx]);

  /**
   * 选中候选 · 对当前 `/<query>` token 做「整段替换」为 `/<cmd> `(自动补全语义)。
   *
   * 关键 fix(v1.x bug 修复点):
   *  - 旧实现用 `deleteCharacter` 反向删 query.length 个字符再 insertText, 当 query
   *    与编辑器实时文本不同步时 (state.query 落后一帧) 会出现少删 / 多删 → 拼接成
   *    `/rec/recall` 这种把命令名追加在 query 后的 bug。
   *  - 新实现直接用 `triggerRef` (`/` 在文本节点中的偏移) 把 selection 扩到
   *    [triggerStart → 当前 cursor], 然后 `insertText('/<cmd> ')` 替换整个 range。
   *    这样无论 query 是否同步, 替换始终精确覆盖用户当前打的命令片段。
   */
  const pickCommand = useCallback(
    (cmd: SlashCommand) => {
      const trigger = triggerRef.current;
      const inserted = `/${cmd.name} `;
      // 同步关闭 + 清触发器 —— 关键: 在 editor.update 之前写 openRef.current = false,
      // 这样 update 引发的 updateListener 一进来就 return, 不会反向把 open 翻回 true。
      openRef.current = false;
      triggerRef.current = undefined;
      setState({ open: false, query: '', x: 0, bottom: 0 });
      setActiveIdx(0);

      if (!trigger) {
        // 兜底: 没拿到 triggerStart(理论不应发生) → 直接在 cursor 处 insertText
        editor.update(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
          (sel as unknown as { insertText: (s: string) => void }).insertText(inserted);
        });
        return;
      }
      editor.update(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        const anchorNode = $getNodeByKey(trigger.nodeKey);
        if (!anchorNode || !$isTextNode(anchorNode)) {
          (sel as unknown as { insertText: (s: string) => void }).insertText(inserted);
          return;
        }
        const cursorKey = sel.anchor.key;
        const cursorOffset = sel.anchor.offset;
        const focusNode = $getNodeByKey(cursorKey);
        if (!focusNode || !$isTextNode(focusNode)) {
          // 光标不在 TextNode (理论不应发生) → 兜底
          (sel as unknown as { insertText: (s: string) => void }).insertText(inserted);
          return;
        }
        // 把选区扩成 [trigger → cursor], 然后用 insertText 整段替换
        (sel as RangeSelection).setTextNodeRange(
          anchorNode,
          trigger.offset,
          focusNode,
          cursorOffset,
        );
        (sel as unknown as { insertText: (s: string) => void }).insertText(inserted);
      });
      logger.debug('pick → 自动补全命令文本', { name: cmd.name, inserted });
    },
    [editor],
  );

  // 找到 editor 根节点所在的 shadowRoot, 用作 portal 目标; 这样菜单脱离 EditorShell
  // 的 overflow 和 CollapsiblePanel 的 transform 影响。
  const editorRoot = editor.getRootElement();
  const shadowRoot = editorRoot?.getRootNode();
  const portalTarget =
    shadowRoot instanceof ShadowRoot ? shadowRoot : (document.body as Element | ShadowRoot);

  const menu = (
    <CommandMenu
      visible={state.open}
      commands={filtered}
      activeIndex={activeIdx}
      x={state.x}
      bottom={state.bottom}
      onPick={pickCommand}
      onHover={setActiveIdx}
    />
  );

  return state.open
    ? createPortal(menu, portalTarget as Element | DocumentFragment)
    : null;
}
