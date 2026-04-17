/**
 * SubmitPlugin · 回车发送 / Shift+Enter 换行
 * ---------------------------------------------
 */
import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND } from 'lexical';

export interface SubmitPluginProps {
  onSubmit: () => void;
}

export function SubmitPlugin({ onSubmit }: SubmitPluginProps) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event && (event as KeyboardEvent).shiftKey) {
          return false; // 让默认换行发生
        }
        event?.preventDefault();
        onSubmit();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onSubmit]);
  return null;
}
