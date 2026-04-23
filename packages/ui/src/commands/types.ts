/**
 * 斜杠命令接口
 * ---------------------------------------------
 * v0.2.1 · 在保持向后兼容的前提下新增：
 * - `execute(ctx, rawArgs?)`：命令可选接收 `/name 之后的用户原文`，用于实现
 *   `/recall <query>` / `/topic <text>` 这类带参命令。
 * - Context 新增一组可选能力（startNewVisit / triggerRecall / triggerTopicIdentify /
 *   setSessionTopic / appendAssistantNote）；旧宿主未注入时命令自行优雅降级。
 */

export interface SlashCommandContext {
  /** 清空当前窗口的消息流与即将发给 LLM 的 messages */
  clearConversation: () => void;
  /** 关闭命令菜单 */
  closeMenu: () => void;
  /** 弹出 antd 轻提示（可选） */
  notify?: (msg: string) => void;

  /* -------- v0.2.1 新增能力（全部可选，保持向后兼容） -------- */

  /**
   * 开启一个新的 PageVisit（`/new` 语义：清 UI + 新 visitId，但不清 WorkingMemory/Persona/Episodic）。
   * 实现方宜在内部先 `endCurrent()` 再 `startNewVisit(...)` 以触发反思任务登记。
   */
  startNewVisit?: () => Promise<void> | void;

  /**
   * 召回并回显：执行 `recallMemory({ query, mode: 'explicit' })` 并把结果
   * 作为一条 assistant 消息追加到 UI（通常由 appendAssistantNote 完成）。
   */
  triggerRecall?: (query: string) => Promise<void>;

  /**
   * 强制触发一次 SessionTopic 识别（调辅助 LLM）。
   */
  triggerTopicIdentify?: () => Promise<void>;

  /**
   * 手动设置当前 visit 的 SessionTopic（不调 LLM）。
   */
  setSessionTopic?: (text: string) => Promise<void>;

  /**
   * 直接向聊天流追加一条"非流式" assistant 消息（用于 /recall 结果回显）。
   */
  appendAssistantNote?: (content: string) => void;
}

export interface SlashCommand {
  name: string;
  description: string;
  /** 命令在 menu 中显示的图标（emoji 或文字） */
  icon?: string;
  /**
   * 执行命令。
   * @param ctx 宿主注入的能力集合
   * @param rawArgs `/name ` 之后的用户原文（已 trim）。无参数时为 undefined 或空串。
   */
  execute(ctx: SlashCommandContext, rawArgs?: string): void | Promise<void>;
}
