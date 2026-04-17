/**
 * SystemPromptSource
 * ---------------------------------------------
 * 注入 Agent 的角色定义 + 工具使用规范。
 * 最高 priority，始终排在 messages 第一位。
 */
import type { ContextSegment, ContextSource, AgentInvokeContext } from './source';

export function createSystemPromptSource(systemPrompt: string): ContextSource {
  return {
    name: 'system-prompt',
    priority: 100,
    async gather(_ctx: AgentInvokeContext): Promise<ContextSegment> {
      return {
        source: 'system-prompt',
        message: { role: 'system', content: systemPrompt },
      };
    },
  };
}
