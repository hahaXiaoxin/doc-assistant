/**
 * 斜杠命令注册中心
 * ---------------------------------------------
 * v0.2.1 默认注册：/new /recall /topic
 * PHASE3: /forget（真的从记忆层删除）/summary 等会在此注册。
 */
import type { SlashCommand } from './types';
import { newCommand } from './new-command';
import { recallCommand } from './recall-command';
import { topicCommand } from './topic-command';

export class SlashCommandRegistry {
  private cmds = new Map<string, SlashCommand>();

  register(cmd: SlashCommand): void {
    this.cmds.set(cmd.name, cmd);
  }

  has(name: string): boolean {
    return this.cmds.has(name);
  }

  get(name: string): SlashCommand | undefined {
    return this.cmds.get(name);
  }

  /** 按名称前缀筛选（支持模糊搜索） */
  query(prefix: string): SlashCommand[] {
    const p = prefix.toLowerCase();
    return [...this.cmds.values()].filter(
      (c) => c.name.toLowerCase().startsWith(p) || c.description.toLowerCase().includes(p),
    );
  }

  list(): SlashCommand[] {
    return [...this.cmds.values()];
  }
}

export function createDefaultCommandRegistry(): SlashCommandRegistry {
  const r = new SlashCommandRegistry();
  r.register(newCommand);
  r.register(recallCommand);
  r.register(topicCommand);
  return r;
}
