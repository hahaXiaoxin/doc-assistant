/**
 * /recall 命令
 * ---------------------------------------------
 * 用法：`/recall <自然语言关键词>`
 *
 * 行为(v1.3):
 * - **有 args**：直接走 `ctx.triggerRecall(query)` —— 由宿主实现,通常执行
 *   recallMemory({ mode:'explicit' }) 并把结果作为 assistant 消息渲染到聊天流。
 * - **无 args**：notify 一条用法提示后静默返回,不再弹 Modal。
 *
 * 历史:v1.2 曾尝试用 `requestRecallQuery` 弹一个输入框 Modal,但用户反馈更喜欢
 * 直接在输入框里接着打 query —— 所以 v1.3 回到「单一路径」:用户在 pick 命令
 * 后看到 `/recall ` 已填好,直接续打内容、回车发送即走召回链路。无 args 的提交
 * 不再是合法用法,只 notify 一行提示。
 */
import type { SlashCommand } from './types';

export const recallCommand: SlashCommand = {
  name: 'recall',
  description: '从历史记忆中召回相关对话（用法：/recall 关键词）',
  icon: '📚',
  async execute(ctx, rawArgs) {
    const query = (rawArgs ?? '').trim();
    ctx.closeMenu();
    if (!query) {
      ctx.notify?.('用法：/recall 关键词；例如：/recall agent loop 的兜底');
      return;
    }
    try {
      await ctx.triggerRecall(query);
    } catch (err) {
      ctx.notify?.(`召回失败：${(err as Error).message}`);
    }
  },
};
