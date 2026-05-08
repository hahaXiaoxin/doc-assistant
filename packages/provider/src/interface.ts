/**
 * LLMProvider 接口
 * ---------------------------------------------
 * 职责：屏蔽不同厂商（千问 / 未来的 Claude / Gemini / Ollama）的 HTTP 协议、流式协议、
 * tool-calling 协议差异，向 Agent 层暴露稳定的契约。
 *
 * 关键设计：
 * - chat(): 返回 AsyncIterable<ChatChunk>，Agent 用 for-await 消费
 * - 所有厂商特有字段（Qwen 的 enable_thinking、DeepSeek 的 thinking.type、
 *   reasoning_content 等）都封装在具体实现内部；对外思考模式统一为 `thinking: boolean`
 * - getModelInfo(): 让 Agent 能感知模型能力（是否支持 tool / reasoning / 上下文窗口）
 *
 * 架构红线：
 * - Agent 层严禁 import 'ai' / '@ai-sdk/*'（ESLint 强约束）
 * - 所有 LLM 访问必须通过本接口
 */

import type {
  ChatChunk,
  ChatMessage,
  ToolDefinition,
} from '@doc-assistant/shared';

export interface ChatParams {
  messages: ChatMessage[];
  /** Agent 注入给 LLM 的工具列表；Provider 负责转换为厂商对应格式 */
  tools?: ToolDefinition[];
  /** 外部取消 */
  signal?: AbortSignal;
  /** 临时覆盖默认模型（如针对某个 Agent 单独选择更合适的模型档位） */
  modelOverride?: string;
  /** 临时覆盖温度等参数 */
  temperature?: number;
}

export interface ModelInfo {
  /** 当前使用的模型 id（如 qwen-plus） */
  id: string;
  /** 粗略的上下文窗口 token 数（用于上层做截断决策） */
  contextWindow: number;
  /**
   * 模型声明的单次请求最大输出 token 数上限（可选）
   * ---------------------------------------------
   * 仅作为"能力声明"供上层参考（例如计价估算 / 预算 / 警告），
   * 不影响运行时默认 `max_tokens`——后者仍由 Provider / Agent 层保守决定，
   * 不会自动撑到此上限（避免单次请求把配额打爆）。
   * 未设置时表示未知（不代表 0），上层应当按"不做上限假设"处理。
   */
  maxOutputTokens?: number;
  /** 是否支持 reasoning_content */
  supportsReasoning: boolean;
  /** 是否支持 tool calling */
  supportsTools: boolean;
}

export interface LLMProvider {
  /**
   * 发起一次对话，返回归一化的 chunk 流。
   * 当流结束时必定有一个 `finish` chunk；遇到错误则发一个 `error` chunk。
   */
  chat(params: ChatParams): AsyncIterable<ChatChunk>;

  /** 查询当前 Provider 使用的模型信息，用于 Agent 做能力判断 */
  getModelInfo(): ModelInfo;
}
