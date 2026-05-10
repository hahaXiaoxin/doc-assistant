/**
 * HookRegistry · OpenAI 兼容 Provider 的扩展点流水线
 * ---------------------------------------------
 * v0.6.0-beta.2 起,`OpenAICompatibleProvider` 的子类不再通过 override
 * `getRequestBodyExtras` / `patchOutgoingMessage` 这种"protected 方法"扩展行为,
 * 改为在构造函数里向 `this.hooks` 注册 hook,基类按 kind + 优先级串成流水线。
 *
 * 设计原则(简陋为先,不过度抽象):
 * - 只支持本期实际用到的两种 kind(`request:body` / `message:outgoing`),其它需求
 *   再扩展 enum,**不做**预留
 * - 同步执行,不做 async / 短路 / 卸载 / 动态启停
 * - hook 抛错向上传播,**不吞**(契约上 hook 写错就该 fail fast)
 * - 数字越小越先执行;默认 0;同优先级保持注册顺序(JS Array.prototype.sort 自 ES2019
 *   起规范要求稳定排序,直接用即可)
 */
import {
  createLogger,
  type ChatMessage,
} from '@doc-assistant/shared';
import type { ChatParams } from '../interface';
import type { OpenAIChatRequest, OpenAIMessage } from './sse-chat';

/** 当前支持的 hook 种类。新增需求请扩展本枚举。 */
export type HookKind =
  | 'request:body' // 装饰整个 chat completions 请求体
  | 'message:outgoing'; // 装饰单条 ChatMessage → OpenAIMessage 转换结果

export interface RequestBodyHookCtx {
  params: ChatParams;
}

export type RequestBodyHookFn = (
  body: OpenAIChatRequest,
  ctx: RequestBodyHookCtx,
) => OpenAIChatRequest;

export interface MessageOutgoingHookCtx {
  params: ChatParams;
  /**
   * 原始 ChatMessage(转换前),让 hook 能读 reasoning / role 等只在 ChatMessage
   * 上的字段(例:DeepSeek 把 ChatMessage.reasoning 注入到 reasoning_content)。
   */
  source: ChatMessage;
}

export type MessageOutgoingHookFn = (
  msg: OpenAIMessage,
  ctx: MessageOutgoingHookCtx,
) => OpenAIMessage;

export interface ProviderHook {
  kind: HookKind;
  /** 数字越小越先执行;默认 0;同优先级保持注册顺序 */
  priority?: number;
  fn: RequestBodyHookFn | MessageOutgoingHookFn;
  /** 可选名字用于调试日志(没传时用 `<priority=N>` 兜底) */
  name?: string;
}

/**
 * 单个 kind 的 hook 输入(register 时根据 kind 字段判别 fn 类型),
 * 比 ProviderHook 更具体,避免子类注册时丢失 fn 参数的类型推断。
 */
export type RequestBodyHookInput = {
  kind: 'request:body';
  priority?: number;
  fn: RequestBodyHookFn;
  name?: string;
};
export type MessageOutgoingHookInput = {
  kind: 'message:outgoing';
  priority?: number;
  fn: MessageOutgoingHookFn;
  name?: string;
};
export type HookInput = RequestBodyHookInput | MessageOutgoingHookInput;

const logger = createLogger('provider:hooks');

/**
 * Hook 注册表。每个 OpenAICompatibleProvider 实例持有一个,在构造函数里 register。
 *
 * 内部实现要点:
 * - register 时把 hook 推入数组并立即做稳定升序排序
 * - run* 方法遍历,按 kind 过滤,把上一步结果传给下一步,immutable 风格
 * - 不做异步、不做短路、不做卸载——本期没需求,简陋为先
 */
export class HookRegistry {
  private hooks: ProviderHook[] = [];

  register(hook: HookInput): void {
    this.hooks.push(hook as ProviderHook);
    // 稳定升序:JS Array.prototype.sort 自 ES2019 起规范要求稳定
    this.hooks.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  runRequestBody(body: OpenAIChatRequest, ctx: RequestBodyHookCtx): OpenAIChatRequest {
    let cur = body;
    for (const h of this.hooks) {
      if (h.kind !== 'request:body') continue;
      logger.debug('hook run', { kind: h.kind, name: hookLabel(h) });
      cur = (h.fn as RequestBodyHookFn)(cur, ctx);
    }
    return cur;
  }

  runMessageOutgoing(
    msg: OpenAIMessage,
    ctx: MessageOutgoingHookCtx,
  ): OpenAIMessage {
    let cur = msg;
    for (const h of this.hooks) {
      if (h.kind !== 'message:outgoing') continue;
      logger.debug('hook run', { kind: h.kind, name: hookLabel(h) });
      cur = (h.fn as MessageOutgoingHookFn)(cur, ctx);
    }
    return cur;
  }
}

function hookLabel(h: ProviderHook): string {
  return h.name ?? `<priority=${h.priority ?? 0}>`;
}
