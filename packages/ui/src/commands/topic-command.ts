/**
 * /topic 命令
 * ---------------------------------------------
 * 用法：
 *   /topic                 → 强制触发一次"主题识别"（调辅助 LLM）
 *   /topic <自定义描述>    → 直接把 SessionTopic 手动设置为该文案（不调 LLM）
 */
import type { SlashCommand } from './types';

export const topicCommand: SlashCommand = {
  name: 'topic',
  description: '识别或手动设置当前话题（用法：/topic 或 /topic 新话题）',
  icon: '🏷️',
  async execute(ctx, rawArgs) {
    const text = (rawArgs ?? '').trim();
    ctx.closeMenu();
    if (text) {
      try {
        await ctx.setSessionTopic(text);
        ctx.notify?.(`当前话题已设置为：${text}`);
      } catch (err) {
        ctx.notify?.(`设置话题失败：${(err as Error).message}`);
      }
      return;
    }
    try {
      ctx.notify?.('正在识别当前话题...');
      await ctx.triggerTopicIdentify();
      ctx.notify?.('话题识别完成');
    } catch (err) {
      ctx.notify?.(`识别话题失败：${(err as Error).message}`);
    }
  },
};
