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
}

export interface ChatInputActions {
  insertReference: (payload: ReferencePayload) => void;
  clear: () => void;
  focus: () => void;
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
}: {
  actionsRef?: React.MutableRefObject<ChatInputActions | null>;
  insertRef: React.MutableRefObject<((p: ReferencePayload) => void) | null>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      // 注意：这里不能直接写 `() => {}`，必须从 insertRef 实时读最新值。
      // InsertReferencePlugin 的 useEffect 会在自己挂载后才通过 registerInsert
      // 把真正的 fn 填入 insertRef.current；而 ActionsBridge 与 InsertReferencePlugin
      // 的 useEffect 执行顺序按 JSX 顺序，不能保证谁先谁后，所以统一走 ref 取最新值。
      insertReference: (payload) => insertRef.current?.(payload),
      clear: () => clearEditor(editor),
      focus: () => editor.focus(),
    };
    return () => {
      actionsRef.current = null;
    };
  }, [editor, actionsRef, insertRef]);
  return null;
}

export function LexicalChatInput(props: LexicalChatInputProps) {
  const editorRef = useRef<{ userInput: string; references: ReferencePayload[] }>({
    userInput: '',
    references: [],
  });
  const insertRef = useRef<((p: ReferencePayload) => void) | null>(null);

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
    props.onSubmit(payload);
  };

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
            editorRef.current = serializeEditorState(editor);
          }}
        />
        <SubmitPlugin onSubmit={handleSubmit} />
        <InsertReferencePlugin
          registerInsert={(fn) => {
            insertRef.current = fn;
          }}
        />
        <SlashCommandPlugin registry={props.slashRegistry} context={props.slashContext} />
        {props.actionsRef && <ActionsBridge actionsRef={props.actionsRef} insertRef={insertRef} />}
      </LexicalComposer>
    </EditorShell>
  );
}
