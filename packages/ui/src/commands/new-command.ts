/**
 * /new 命令（v0.2.1 重构）
 * ---------------------------------------------
 * 语义：**重启当前对话窗口**。
 * - 清空 UI 消息与下一次将发给 LLM 的 history（通过 `clearConversation`）。
 * - 开启一个新的 PageVisit（新 visitId），让后续的 Episodic/SessionTopic 索引独立。
 * - **不**清 WorkingMemory / Persona / Episodic（它们仍按 canonicalUrl/visitId 被召回）。
 *
 * 向后兼容：当宿主未注入 `startNewVisit`（如单测 / 旧宿主）时，依旧只清 UI。
 */
import type { SlashCommand } from './types';

export const newCommand: SlashCommand = {
  name: 'new',
  description: '重启当前窗口的对话（清 UI + 新 visitId；不影响长期记忆）',
  icon: '🆕',
  async execute(ctx) {
    ctx.clearConversation();
    if (ctx.startNewVisit) {
      try {
        await ctx.startNewVisit();
      } catch (err) {
        ctx.notify?.(`开启新 visit 失败：${(err as Error).message}`);
      }
    }
    ctx.notify?.('已开启新的会话');
    ctx.closeMenu();
  },
};
