/**
 * SlashCommandPlugin · `/` 触发命令面板
 * ---------------------------------------------
 * 实现要点：
 * - 监听 editor 的更新，检测光标前是否存在以 `/` 开头的连续文本（无空格）
 * - 命中则弹出 CommandMenu，展示按前缀过滤后的命令
 * - 键盘：↑↓ 选择、Enter/Tab 执行、Esc 关闭
 * - 选中命令后从编辑器里移除 `/xxx` 片段，再执行命令的 execute
 * - 通过 OnChangePlugin 回调检查 rootElement.textContent 的最后一段
 * - 命令菜单位置通过 window.getSelection().getRangeAt(0).getBoundingClientRect() 计算
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  KEY_ENTER_COMMAND,
  $createTextNode,
} from 'lexical';
import { createLogger } from '@doc-assistant/shared';
import { CommandMenu } from '../../components/CommandMenu';
import type { SlashCommand, SlashCommandContext } from '../../commands/types';
import type { SlashCommandRegistry } from '../../commands/registry';

const logger = createLogger('ui:slash-command');

export interface SlashCommandPluginProps {
  registry: SlashCommandRegistry;
  context: SlashCommandContext;
}

interface MenuState {
  open: boolean;
  query: string;
  /** 菜单锚点视口坐标：x 对应 CSS `left`，bottom 对应 CSS `bottom`（距视口底部） */
  x: number;
  bottom: number;
  /** 命中 `/` 开始的文本节点信息，用于命令执行后删除 */
  triggerStart?: { nodeKey: string; offset: number };
}

export function SlashCommandPlugin({ registry, context }: SlashCommandPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<MenuState>({
    open: false,
    query: '',
    x: 0,
    bottom: 0,
  });
  const [activeIdx, setActiveIdx] = useState(0);

  const filtered = useMemo(() => {
    // state.query 形如 `/recall agent loop`；按空格切出命令名用于前缀过滤
    if (!state.query) return registry.list();
    const withoutSlash = state.query.slice(1);
    const firstToken = withoutSlash.split(/\s/, 1)[0] ?? '';
    return registry.query(firstToken);
  }, [registry, state.query]);

  const close = useCallback(() => {
    setState((s) => ({ ...s, open: false, query: '' }));
    setActiveIdx(0);
  }, []);

  // 监听每次 editor 更新检测斜杠命令
  useEffect(() => {
    const unregister = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) {
          close();
          return;
        }
        const anchor = sel.anchor;
        const node = anchor.getNode();
        const text = node.getTextContent();
        // 取光标前的最后一段。允许 /name 后跟任意非换行字符（含空格）以支持带参命令。
        const before = text.slice(0, anchor.offset);
        // (?:^|[\s\n])?  可选的前置空白
        // (\/[A-Za-z0-9_-]+  )  命令名
        // ([^\n]*)  可选的 参数区（非换行字符）
        // $  光标在末尾
        const m = /(?:^|[\s\n])?(\/[A-Za-z0-9_-]+)([^\n]*)$/.exec(before);
        if (!m || !m[1]) {
          close();
          return;
        }
        const cmdName = m[1]; // 形如 "/recall"
        const argsPart = m[2] ?? ''; // 形如 " agent loop" 或 ""
        const query = cmdName + argsPart;
        logger.debug('匹配 slash 前缀', { query, anchorOffset: anchor.offset });

        // 菜单位置 · 固定出现在输入框上方：
        //  - 用 bottom 锚定（距视口底部 = viewport.height - anchor.top），
        //    这样菜单无论多高多矮都紧贴输入框顶部
        //  - 水平 x 以 anchor.left 为锚并做边界 clamp，避免超出视口
        const MENU_W = 320;
        const EDGE = 8;

        const root = editor.getRootElement();

        // 获取 input 外层元素，获取不到的话就使用 root
        const inputOuterEle = (() => {
            let ele = root;

            while (ele) {
                if (ele.id === 'chat-input-outer') return ele;
                ele = ele.parentElement;
            }

            return root;
        })();

        const rect = inputOuterEle?.getBoundingClientRect();
        const anchorLeft = rect?.left ?? 0;
        const anchorTop = rect?.top ?? 0;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let x = anchorLeft;
        if (x + MENU_W > vw - EDGE) x = vw - EDGE - MENU_W;
        if (x < EDGE) x = EDGE;

        const bottom = vh - anchorTop;

        setState({
          open: true,
          query,
          x,
          bottom,
          triggerStart: { nodeKey: node.getKey(), offset: anchor.offset - query.length },
        });
        setActiveIdx(0);
      });
    });
    return unregister;
  }, [editor, close]);

  // 键盘导航
  useEffect(() => {
    const off1 = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      () => {
        if (!state.open) return false;
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const off2 = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      () => {
        if (!state.open) return false;
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
    const pick = () => {
      if (!state.open) return false;
      const cmd = filtered[activeIdx];
      if (!cmd) return false;
      executeCommand(cmd);
      return true;
    };
    const off4 = editor.registerCommand(KEY_ENTER_COMMAND, pick, COMMAND_PRIORITY_HIGH);
    const off5 = editor.registerCommand(KEY_TAB_COMMAND, pick, COMMAND_PRIORITY_HIGH);
    return () => {
      off1();
      off2();
      off3();
      off4();
      off5();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, state.open, filtered, activeIdx]);

  const executeCommand = (cmd: SlashCommand) => {
    // 1. 删除触发 `/xxx` 文本
    const trigger = state.triggerStart;
    if (trigger) {
      editor.update(() => {
        const node = editor.getEditorState().read(() =>
          editor._nodes.get('text') ? null : null,
        );
        void node;
        // 简化：用当前 selection 方式删除 query 长度
        const sel = $getSelection();
        if ($isRangeSelection(sel) && sel.isCollapsed()) {
          // 使用原生方式：backspace 多次
          const queryLen = state.query.length;
          for (let i = 0; i < queryLen; i++) {
            (sel as unknown as { deleteCharacter: (isBackward: boolean) => void }).deleteCharacter(
              true,
            );
          }
          // 插入一个空文本以稳定光标
          (sel as unknown as { insertNodes: (n: unknown[]) => void }).insertNodes([
            $createTextNode(''),
          ]);
        }
      });
    }
    close();
    // 解析参数：state.query 形如 `/recall agent loop`；剥掉 `/cmd ` 前缀作为 rawArgs
    const afterSlash = state.query.slice(1); // "recall agent loop"
    const spaceIdx = afterSlash.indexOf(' ');
    const rawArgs = spaceIdx >= 0 ? afterSlash.slice(spaceIdx + 1).trim() : undefined;
    void cmd.execute(context, rawArgs);
  };

  // 找到 editor 根节点所在的 shadowRoot，用作 portal 目标；
  // 这样菜单脱离 EditorShell 的 overflow 和 CollapsiblePanel 的 transform 影响。
  // fallback：真的拿不到 shadowRoot 时 portal 到 document.body（退化场景，样式隔离可能不完美）。
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
      onPick={executeCommand}
      onHover={setActiveIdx}
    />
  );

  return state.open
    ? createPortal(menu, portalTarget as Element | DocumentFragment)
    : null;
}
