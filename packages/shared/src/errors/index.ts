/**
 * 统一错误类型
 * ---------------------------------------------
 * 每一层抛出自己的错误子类，便于上层通过 instanceof 精准处理。
 * 统一携带可选的 cause（ES2022 Error.cause）以保留原始堆栈。
 */

export class DocAssistantError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Provider 层错误（协议、鉴权、网络、流解析） */
export class ProviderError extends DocAssistantError {}

/** Tools 层错误（页面提取、工具执行） */
export class ToolError extends DocAssistantError {}

/** Agent 层错误（上下文组装、tool-calling loop） */
export class AgentError extends DocAssistantError {}

/** 用户中断 */
export class AbortError extends DocAssistantError {
  constructor(message = '用户中断') {
    super('ABORTED', message);
  }
}
