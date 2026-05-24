/**
 * LexicalChatInput · 对话输入框
 * ---------------------------------------------
 * 职责：
 * - 初始化 Lexical Composer
 * - 注册自定义 ReferenceNode + renderer
 * - 组合插件：HistoryPlugin / SubmitPlugin / SlashCommandPlugin / InsertReferencePlugin
 * - 暴露 onSubmit(userInput, references) 给外部
 */
import { useEffect, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ReferenceNode, setReferenceRenderer, type ReferencePayload } from './nodes/ReferenceNode';
import { ReferenceTag } from '../components/ReferenceTag';
import { SubmitPlugin } from './plugins/SubmitPlugin';
import { InsertReferencePlugin } from './plugins/InsertReferencePlugin';
import { SlashCommandPlugin } from './plugins/SlashCommandPlugin';
import { SlashCommandRegistry } from '../commands/registry';
import type { SlashCommandContext } from '../commands/types';
import { serializeEditorState, clearEditor } from './serializer';
import { tokens } from '../theme/tokens';

export interface LexicalChatInputProps {
  disabled?: boolean;
  placeholder?: string;
  slashRegistry: SlashCommandRegistry;
  slashContext: SlashCommandContext;
  onSubmit: (payload: { userInput: string; references: ReferencePayload[] }) => void;
  /** 允许外部调用 insertReference / clear 等方法的 ref */
  actionsRef?: React.MutableRefObject<ChatInputActions | null>;
  /**
   * v1.1 PR-3 C3 · 每次编辑器内容变化时回调 isEmpty,供外部驱动发送按钮的
   * disabled 状态。判据: 序列化后的 `userInput.trim()` 为空且无 references。
   * 不走 ref 轮询,避免外部每帧 setState。
   */
  onContentChange?: (isEmpty: boolean) => void;
}

export interface ChatInputActions {
  insertReference: (payload: ReferencePayload) => void;
  clear: () => void;
  focus: () => void;
  /**
   * v1.1 PR-3 C3 · 外部按钮触发发送;语义等价于键盘回车(仍经 onSubmit 回调)。
   * 空输入 / disabled 时走和键盘回车相同的兜底(不触发 onSubmit)。
   */
  submit: () => void;
}

const EditorShell = styled.div`
  position: relative;
  border: 1px solid ${tokens.color.border};
  border-radius: ${tokens.radius.md};
  background: ${tokens.color.bgWhite};
  padding: 10px 12px;
  min-height: 64px;
  max-height: 200px;
  overflow-y: auto;
  transition: border-color ${tokens.motion.fast}, box-shadow ${tokens.motion.fast};

  &:focus-within {
    border-color: ${tokens.color.primary};
    box-shadow: ${tokens.shadow.focus};
  }
`;

const EditableStyled = styled(ContentEditable)`
  outline: none;
  min-height: 44px;
  font-size: ${tokens.font.sizeBody};
  line-height: 1.6;
  color: ${tokens.color.textPrimary};
  caret-color: ${tokens.color.primary};
  word-break: break-word;

  p {
    margin: 0;
  }
`;

const Placeholder = styled.div`
  position: absolute;
  top: 10px;
  left: 12px;
  color: ${tokens.color.textTertiary};
  font-size: ${tokens.font.sizeBody};
  pointer-events: none;
  user-select: none;
`;

// 注册 renderer（只注册一次；Lexical 对同 key 多次注册是幂等的）
setReferenceRenderer((payload) => <ReferenceTag payload={payload} />);

function ActionsBridge({
  actionsRef,
  insertRef,
  submitRef,
  clearRef,
}: {
  actionsRef?: React.MutableRefObject<ChatInputActions | null>;
  insertRef: React.MutableRefObject<((p: ReferencePayload) => void) | null>;
  submitRef: React.MutableRefObject<(() => void) | null>;
  /**
   * v1.2 · 让 LexicalComposer 外层的 handleSubmit 也能在「命令分发命中时」清空
   * 输入框 —— 把 editor 实例上的 clearEditor(editor) 挂到 ref 上,外层闭包通过
   * ref 调用,避免把 editor 一路 prop drilling 出 Composer。
   *
   * 注意:即使调用方没传 actionsRef,clearRef 也要绑 —— 命令路径默认就要 clear。
   */
  clearRef: React.MutableRefObject<(() => void) | null>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    clearRef.current = () => clearEditor(editor);
    if (actionsRef) {
      actionsRef.current = {
        // insertReference 作为闭包实时读 insertRef · 详见 docs/TROUBLESHOOTING.md §6
        // 不能在此直接固化成具体函数——InsertReferencePlugin 和 ActionsBridge
        // 的 useEffect 执行顺序按 JSX 挂载顺序，不保证谁先谁后；固化会吞掉后续注册的真 fn。
        insertReference: (payload) => insertRef.current?.(payload),
        clear: () => clearEditor(editor),
        focus: () => editor.focus(),
        submit: () => submitRef.current?.(),
      };
    }
    return () => {
      clearRef.current = null;
      if (actionsRef) actionsRef.current = null;
    };
  }, [editor, actionsRef, insertRef, submitRef, clearRef]);
  return null;
}

export function LexicalChatInput(props: LexicalChatInputProps) {
  const editorRef = useRef<{ userInput: string; references: ReferencePayload[] }>({
    userInput: '',
    references: [],
  });
  const insertRef = useRef<((p: ReferencePayload) => void) | null>(null);
  const submitRef = useRef<(() => void) | null>(null);
  // v1.2 · clearViaEditorRef 由 ActionsBridge 在 Composer 内层绑定:命令分发命中时
  // 清空输入框。和 actionsRef.clear 不同的是:这条路径无论调用方是否传 actionsRef
  // 都可用(命令路径必清)。
  const clearViaEditorRef = useRef<(() => void) | null>(null);
  // v1.1 PR-3 C3 · 本地缓存 isEmpty 的上次值,避免每次 onChange 都打父组件 setState。
  const lastIsEmptyRef = useRef<boolean>(true);

  const initialConfig = useMemo(
    () => ({
      namespace: 'doc-assistant-chat-input',
      theme: {
        paragraph: 'paragraph',
      },
      nodes: [ReferenceNode],
      onError: (err: Error) => {
        console.error('[ui:lexical] error:', err);
      },
    }),
    [],
  );

  const handleSubmit = () => {
    if (props.disabled) return;
    const payload = editorRef.current;
    if (!payload.userInput.trim()) return;
    // v1.2 · 统一命令分发器:发送时先看用户输入是不是 `/<已注册命令>`,是则
    // 把它当 slash command 跑掉,**不**作为普通消息发出去;否则走原 onSubmit。
    //
    // 关键不变量(避免回归):
    //  - 只有当 references 为空时才尝试命令分发 —— 用户在输入框里挂了引用,通常
    //    意味着这是一条带上下文的"消息",不该被当成命令吞掉。
    //  - 命令命中时立刻清空输入框,体感跟旧路径(pick→执行)一致。
    //  - registry.dispatch 只严格匹配已注册命令名;陌生 `/foo` 仍会作为普通消息
    //    发出,以免用户的代码片段(`/usr/local/...`)被错误当成命令。
    if (payload.references.length === 0) {
      const r = props.slashRegistry.dispatch(payload.userInput, props.slashContext);
      if (r.handled) {
        clearViaEditorRef.current?.();
        // 命令多为 fire-and-forget;失败由命令内部 notify。这里不 await,
        // 否则会把 LexicalChatInput 的 onSubmit 同步语义搞复杂(目前调用方不期望)。
        void r.result;
        return;
      }
    }
    props.onSubmit(payload);
  };
  submitRef.current = handleSubmit;

  return (
    <EditorShell aria-label="对话输入">
      <LexicalComposer initialConfig={initialConfig}>
        <PlainTextPlugin
          contentEditable={<EditableStyled aria-label="输入消息" />}
          placeholder={
            <Placeholder>{props.placeholder ?? '问点什么，或输入 / 查看命令'}</Placeholder>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <OnChangePlugin
          onChange={(_state, editor) => {
            const payload = serializeEditorState(editor);
            editorRef.current = payload;
            const isEmpty =
              payload.userInput.trim().length === 0 && payload.references.length === 0;
            if (props.onContentChange && isEmpty !== lastIsEmptyRef.current) {
              lastIsEmptyRef.current = isEmpty;
              props.onContentChange(isEmpty);
            }
          }}
        />
        <SubmitPlugin onSubmit={handleSubmit} />
        <InsertReferencePlugin
          registerInsert={(fn) => {
            insertRef.current = fn;
          }}
        />
        <SlashCommandPlugin registry={props.slashRegistry} />
        {/*
          ActionsBridge v1.2 起总是 mount —— clearRef 在命令分发命中时清空输入,
          这条路径独立于 actionsRef,所以即使调用方没传 actionsRef 也得绑。
        */}
        <ActionsBridge
          {...(props.actionsRef ? { actionsRef: props.actionsRef } : {})}
          insertRef={insertRef}
          submitRef={submitRef}
          clearRef={clearViaEditorRef}
        />
      </LexicalComposer>
    </EditorShell>
  );
}
