/**
 * /new 命令
 * ---------------------------------------------
 * 作用：清空当前窗口的对话上下文（UI 消息 + 即将发给 LLM 的 history）。
 * 不影响记忆层（MVP 无记忆层；PHASE2 记忆层落地后此命令仍只清窗口，见 ROADMAP §2）。
 */
import type { SlashCommand } from './types';

export const newCommand: SlashCommand = {
  name: 'new',
  description: '清空当前窗口的对话上下文（不影响长期记忆）',
  icon: '🆕',
  async execute(ctx) {
    ctx.clearConversation();
    ctx.notify?.('已清空当前窗口的对话');
    ctx.closeMenu();
  },
};
