/**
 * /recall 命令
 * ---------------------------------------------
 * v0.2.1 · 用法：
 *   /recall <自然语言关键词>
 *
 * 行为：
 * - 走 `ctx.triggerRecall(query)` —— 由宿主实现，通常执行 recallMemory({ mode:'explicit' })
 *   并把结果渲染成 assistant 消息注入聊天流。
 * - 空参数时给出用法提示并保持菜单打开。
 */
import type { SlashCommand } from './types';

export const recallCommand: SlashCommand = {
  name: 'recall',
  description: '从历史记忆中召回相关对话（用法：/recall 关键词）',
  icon: '📚',
  async execute(ctx, rawArgs) {
    const query = (rawArgs ?? '').trim();
    if (!query) {
      ctx.notify?.('用法：/recall 关键词；例如：/recall agent loop 的兜底');
      ctx.closeMenu();
      return;
    }
    if (!ctx.triggerRecall) {
      ctx.notify?.('当前环境不支持召回（缺少 memory 或 aux）');
      ctx.closeMenu();
      return;
    }
    ctx.closeMenu();
    try {
      await ctx.triggerRecall(query);
    } catch (err) {
      ctx.notify?.(`召回失败：${(err as Error).message}`);
    }
  },
};
