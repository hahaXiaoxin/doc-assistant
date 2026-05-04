/**
 * ChatHistorySource
 * ---------------------------------------------
 * 把当前窗口（UI 看到的）历史消息作为 messages 的主干。
 *
 * 当前截断策略：按字符总数从尾部保留，不使用 tokenizer。
 * PHASE2 将引入更精准的 token 估算与摘要压缩。
 *
 * 注意：本 source 返回的 segment 只包含"最后一条"的形式不够用，因为历史是多条。
 * 因此 ChatHistorySource 通过 `gather` 只返回一个 segment 不足以表达多条消息。
 * 我们让 ChatHistory 产出"空 segment"但通过 composer 特判 —— 这样污染接口。
 *
 * 更好的做法：扩展 ContextSource 返回 ChatMessage[]。这里我们改返回数组形式。
 */
import type { ChatMessage } from '@doc-assistant/shared';
import type { ContextSegment, ContextSource, AgentInvokeContext } from './source';

/**
 * 按字符阈值从尾部截断；保留最近的历史。
 */
function truncateHistory(history: ChatMessage[], maxChars: number): ChatMessage[] {
  let total = 0;
  const result: ChatMessage[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!;
    const len = (msg.content?.length ?? 0) + (msg.toolCalls ? 64 : 0);
    if (total + len > maxChars) break;
    result.unshift(msg);
    total += len;
  }
  return result;
}

/**
 * 创建 ChatHistorySource。
 * @param maxChars 最大字符数（按 chat.settings.maxContextChars 注入）
 */
export function createChatHistorySource(maxChars: number): ContextSource {
  return {
    name: 'chat-history',
    priority: 10, // 历史消息排在最后（靠近当前用户输入）

    async gather(ctx: AgentInvokeContext): Promise<ContextSegment | null> {
      const truncated = truncateHistory(ctx.history, maxChars);
      if (!truncated.length) return null;
      // 特殊协议：把多条历史消息打包成一个 segment，composer 会展开
      return {
        source: 'chat-history',
        message: {
          role: 'system',
          content: '__CHAT_HISTORY_PLACEHOLDER__',
          meta: { historyMessages: truncated },
        },
      };
    },
  };
}
