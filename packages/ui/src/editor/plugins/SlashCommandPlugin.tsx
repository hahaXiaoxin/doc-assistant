/**
 * SlashCommandPlugin · `/` 触发命令面板
 * ---------------------------------------------
 * 实现要点：
 * - 监听 editor 的更新，检测光标前是否存在以 `/` 开头的连续文本（无空格）
 * - 命中则弹出 CommandMenu，展示按前缀过滤后的命令
 * - 键盘：↑↓ 选择、Enter/Tab 执行、Esc 关闭
 * - 选中命令后从编辑器里移除 `/xxx` 片段，再执行命令的 execute
 *
 * 简化实现（MVP 可用）：
 * - 通过 OnChangePlugin 回调检查 rootElement.textContent 的最后一段
 * - 命令菜单位置通过 window.getSelection().getRangeAt(0).getBoundingClientRect() 计算
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
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
import { CommandMenu } from '../../components/CommandMenu';
import type { SlashCommand, SlashCommandContext } from '../../commands/types';
import type { SlashCommandRegistry } from '../../commands/registry';

export interface SlashCommandPluginProps {
  registry: SlashCommandRegistry;
  context: SlashCommandContext;
}

interface MenuState {
  open: boolean;
  query: string;
  x: number;
  y: number;
  /** 命中 `/` 开始的文本节点信息，用于命令执行后删除 */
  triggerStart?: { nodeKey: string; offset: number };
}

export function SlashCommandPlugin({ registry, context }: SlashCommandPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<MenuState>({
    open: false,
    query: '',
    x: 0,
    y: 0,
  });
  const [activeIdx, setActiveIdx] = useState(0);

  const filtered = useMemo(() => {
    return state.query ? registry.query(state.query.slice(1)) : registry.list();
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
        // 取光标前的最后一段非空白
        const before = text.slice(0, anchor.offset);
        const m = /(?:^|[\s\n])?(\/[A-Za-z0-9_-]*)$/.exec(before);
        if (!m || !m[1]) {
          close();
          return;
        }
        const query = m[1];
        // 计算菜单位置
        const domSelection = window.getSelection();
        const range = domSelection && domSelection.rangeCount > 0 ? domSelection.getRangeAt(0) : null;
        const rect = range?.getBoundingClientRect();
        const x = rect?.left ?? 0;
        const y = (rect?.bottom ?? 0) + 4;
        setState({
          open: true,
          query,
          x,
          y,
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
    void cmd.execute(context);
  };

  return (
    <CommandMenu
      visible={state.open}
      commands={filtered}
      activeIndex={activeIdx}
      x={state.x}
      y={state.y}
      onPick={executeCommand}
      onHover={setActiveIdx}
    />
  );
}
