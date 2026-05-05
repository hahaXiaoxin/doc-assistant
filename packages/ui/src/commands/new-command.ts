/**
 * /new 命令
 * ---------------------------------------------
 * 语义：**重启当前对话窗口**。
 * - 先走 `requestClearConversation()`(v1.1 PR-4 C3 · 带 Confirm Modal);如果用户取消,
 *   整条命令**静默终止**,不开启新 visit,不 notify。
 *   宿主若未提供 requestClearConversation,回退到同步 `clearConversation()`。
 * - 确认后:清 UI 消息与下一次将发给 LLM 的 history,再开启一个新的 PageVisit(新 visitId),
 *   让后续的 Episodic/SessionTopic 索引独立。
 * - **不**清 WorkingMemory / Persona / Episodic（它们仍按 canonicalUrl/visitId 被召回）。
 */
import type { SlashCommand } from './types';

export const newCommand: SlashCommand = {
  name: 'new',
  description: '重启当前窗口的对话（清 UI + 新 visitId；不影响长期记忆）',
  icon: '🆕',
  async execute(ctx) {
    // 先关菜单再弹 Modal —— 否则菜单和 Modal 会同屏共存,焦点行为不可预期。
    ctx.closeMenu();

    if (ctx.requestClearConversation) {
      const ok = await ctx.requestClearConversation();
      if (!ok) return; // 用户取消 → 什么都不做
    } else {
      ctx.clearConversation();
    }

    try {
      await ctx.startNewVisit();
    } catch (err) {
      ctx.notify?.(`开启新 visit 失败：${(err as Error).message}`);
      return;
    }
    ctx.notify?.('已开启新的会话');
  },
};

