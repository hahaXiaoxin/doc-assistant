/**
 * @doc-assistant/ui · 入口
 * ---------------------------------------------
 * 职责：对话面板、配置表单、Lexical 编辑器、斜杠命令、主题。
 *
 * 架构约束：
 * - 本包使用 styled-components + Ant Design。
 * - 挂载到 Shadow DOM 时，必须通过 StyleSheetManager 把 styled-components 的 target 指向 shadow root。
 */

// 对话面板
export { ChatPanel, type ChatPanelProps, type PageSummary } from './features/chat/ChatPanel';

// 配置页
export { OptionsForm } from './features/options/OptionsForm';

// 主题
export { tokens } from './theme/tokens';
export { GlobalStyle } from './theme/GlobalStyle';

// 划词桥接
export {
  dispatchInsertReference,
  useSelectionBridge,
  INSERT_REFERENCE_EVENT,
} from './hooks/useSelectionBridge';

// 类型
export type { ReferencePayload } from './editor/nodes/ReferenceNode';
