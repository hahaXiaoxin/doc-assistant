/**
 * AgentOrchestrator
 * ---------------------------------------------
 * 多 Agent 注册与调度。
 * 当前只注册 ChatAgent；PHASE3 新增 CheckerAgent（实时提醒）。
 *
 * 目前只实现"按 name 调度"，未来可扩展"自动路由"（由 router Agent 决定谁来回答）。
 */
import { createLogger, AgentError } from '@doc-assistant/shared';
import type { Agent } from './agent';

const logger = createLogger('agent:orchestrator');

export class AgentOrchestrator {
  private agents = new Map<string, Agent>();

  register(agent: Agent): void {
    this.agents.set(agent.name, agent);
    logger.info(`注册 agent: ${agent.name}（${agent.role}）`);
  }

  unregister(name: string): boolean {
    return this.agents.delete(name);
  }

  get(name: string): Agent {
    const a = this.agents.get(name);
    if (!a) throw new AgentError('AGENT_NOT_FOUND', `Agent "${name}" 未注册`);
    return a;
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }

  // PHASE3: 自动路由与 Agent 间协作（如 CheckerAgent 发出提醒后由 ChatAgent 追问）
}
