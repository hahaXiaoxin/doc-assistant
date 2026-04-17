/**
 * 对话消息与流式 chunk 的通用类型
 * ---------------------------------------------
 * Provider 层和 Agent 层共用这些类型，避免 Agent 直接接触 Provider 内部实现。
 */

/** OpenAI 兼容的角色 */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** Tool 调用（assistant 消息中发起） */
export interface ToolCall {
  id: string;
  name: string;
  /** 参数：JSON 字符串或解析后的对象 */
  args: unknown;
}

/** Tool 调用结果（tool 角色消息内容） */
export interface ToolResult {
  toolCallId: string;
  name: string;
  /** 结果：字符串或可序列化对象 */
  result: unknown;
  isError?: boolean;
}

/** 一条 chat message，足够表达 tool-calling 所需的所有角色 */
export interface ChatMessage {
  role: ChatRole;
  /** 文本内容（user/system/assistant 普通消息） */
  content?: string;
  /** 对于 assistant 消息，发起的 tool 调用 */
  toolCalls?: ToolCall[];
  /** 对于 tool 消息，响应的 toolCallId */
  toolCallId?: string;
  /** 元数据：用于附加引用、思考过程等，不直接发给 LLM */
  meta?: Record<string, unknown>;
}

/**
 * 流式 chat chunk 联合类型
 * ---------------------------------------------
 * Provider 内部把各厂商的 stream part 归一化为本联合，Agent / UI 层只消费这个。
 */
export type ChatChunk =
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; result: ToolResult }
  | {
      type: 'finish';
      /**
       * 本次"整段 Agent 运行"的结束原因：stop / tool_calls / length / content_filter / abort / error
       *
       * 语义约定（重要）：
       * - 这里的 finish **代表 Agent 层整段对话的结束**（包含所有 tool-calling 轮次）
       * - 底层每次 LLM HTTP 请求也会有自己的 "finish"，但 runAgentLoop 会吞掉那些中间 finish，
       *   只在真正结束时合成一个 finish yield 给外层
       * - UI 层可以安全地在收到 finish 后 break 订阅
       */
      finishReason:
        | 'stop'
        | 'tool_calls'
        | 'length'
        | 'content_filter'
        | 'abort'
        | 'error'
        | 'other';
      /** token 使用量（如果 Provider 返回） */
      usage?: {
        promptTokens?: number;
        completionTokens?: number;
        reasoningTokens?: number;
      };
    }
  | { type: 'error'; error: Error };

/** Tool 定义：供 Agent 注入给 LLM */
// 使用 any 以便具体 Tool 指定具体的 TInput/TOutput 后仍能放入同一个数组。
// Agent 层在 execute 时会用 zod 做运行时校验，保持类型安全。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  /** JSON Schema（可由 zod-to-json-schema 生成，Provider 内部会转换为各家厂商格式） */
  parametersJsonSchema: Record<string, unknown>;
  /** 在宿主（扩展 content 或 sidebar）执行 */
  execute: (args: TInput, ctx: ToolExecutionContext) => Promise<TOutput>;
}

export interface ToolExecutionContext {
  signal?: AbortSignal;
  /** 可选：当前 tab/页面的关联信息 */
  meta?: Record<string, unknown>;
}
