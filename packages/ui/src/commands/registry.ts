/**
 * 斜杠命令注册中心
 * ---------------------------------------------
 * v0.2.1 默认注册：/new /recall /topic
 * PHASE3: /forget（真的从记忆层删除）/summary 等会在此注册。
 *
 * v1.2 · 解耦 pick 与 dispatch：
 * - SlashCommandPlugin 在用户从面板里选中候选时,**只**把 `/<name> ` 文本插入
 *   到编辑器（不再各自触发副作用）。
 * - 真正的"行为分发"统一在「发送时」由 `LexicalChatInput.handleSubmit` 调
 *   `registry.dispatch(rawText, ctx)` 完成 —— 解析输入开头的 `/<cmd>`,查注册
 *   表,匹配则调 `cmd.execute(ctx, rawArgs)` 并返回 'handled';否则返回 'passthrough'
 *   交回宿主当普通消息发出。
 *
 * 这样所有命令的副作用统一收敛到「submit 路径」,新命令也只需在注册表登记一次,
 * 面板候选 + 发送分发用同一个数据源,避免再出现 "/recall 该弹窗却没接上" 这种
 * 行为分散的回归。
 */
import type { SlashCommand, SlashCommandContext } from './types';
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

  /**
   * 解析 raw 输入,如果首 token 是 `/<已注册命令>`,则就地执行并返回 handled 结果。
   * - 第一行(忽略前导空白)以 `/` 开头,且首 token 严格匹配某条注册命令时 → 命中。
   * - 命中后 `cmd.execute(ctx, rawArgs)` 被同步触发(返回的 Promise 由调用方决定要不要 await);
   *   `rawArgs` = `/<name>` 之后的剩余文本(已 trim,空则 undefined)。
   * - 不命中(没 `/`、未注册的 `/foo`、有引用 references 等) → 返回 passthrough,
   *   调用方按普通消息走 `chat.send(...)`。
   *
   * 注意:这里**不**做"以 `/` 开头但未匹配则当命令"的兜底 —— 用户可能就是想发一条
   * 以斜杠开头的普通文本(比如代码片段 `/usr/local/...`)。只匹配已注册命令更稳。
   */
  dispatch(
    rawText: string,
    ctx: SlashCommandContext,
  ): { handled: true; result: void | Promise<void> } | { handled: false } {
    const trimmed = rawText.trimStart();
    if (!trimmed.startsWith('/')) return { handled: false };
    // 取第一行,避免多行消息的第二行影响命令名解析
    const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? '';
    // /<name>(<空白><args>)?
    const m = /^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(firstLine);
    if (!m) return { handled: false };
    const name = m[1] ?? '';
    if (!name) return { handled: false };
    const rawArgs = (m[2] ?? '').trim();
    const cmd = this.cmds.get(name);
    if (!cmd) return { handled: false };
    return { handled: true, result: cmd.execute(ctx, rawArgs || undefined) };
  }
}

export function createDefaultCommandRegistry(): SlashCommandRegistry {
  const r = new SlashCommandRegistry();
  r.register(newCommand);
  r.register(recallCommand);
  r.register(topicCommand);
  return r;
}
