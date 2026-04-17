/**
 * 斜杠命令接口
 * ---------------------------------------------
 * MVP 注册：/new
 * 未来（PHASE2）可添加：/forget /recall /summary 等
 */

export interface SlashCommandContext {
  /** 清空当前窗口的消息流与即将发给 LLM 的 messages */
  clearConversation: () => void;
  /** 关闭命令菜单 */
  closeMenu: () => void;
  /** 获取 antd message 实例以弹出提示（可选） */
  notify?: (msg: string) => void;
}

export interface SlashCommand {
  name: string;
  description: string;
  /** 命令在 menu 中显示的图标（emoji 或文字） */
  icon?: string;
  execute(ctx: SlashCommandContext): void | Promise<void>;
}
