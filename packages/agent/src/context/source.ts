/**
 * ContextSource 抽象
 * ---------------------------------------------
 * 核心设计：
 * - 每个 Agent 持有一组 ContextSource，按 priority 降序组装发送给 LLM 的 messages
 * - ContextSegment 是 source 产出的一段结构化内容，可对应一条 system/user 消息或消息的附加文本
 * - MVP 注册 4 个 source（SystemPromptSource/PageContextSource/ReferenceTagSource/ChatHistorySource）
 * - v0.2 Phase2 新增 4 个（PersonaSource/SessionTopicSource/WorkingMemorySource/RelevantMemorySource）
 *
 * 每个 Agent 可以有自己的 Source 组合，实现"各自的上下文获取逻辑"。
 */
import type { ChatMessage } from '@doc-assistant/shared';

/** Agent 调用时传入的上下文（用户输入 + 页面信息 + visit 标识 + 运行时） */
export interface AgentInvokeContext {
  /** 本轮用户输入（已做好 ReferenceTag 序列化） */
  userInput: string;
  /** 当前会话内的历史消息（UI 窗口当前看到的） */
  history: ChatMessage[];
  /** 当前页面信息（若可用） */
  page?: {
    url: string;
    title: string;
    /**
     * v1.1 PR-1：已移除 `summary` 字段。
     * Context 层不再注入页面正文摘要 —— 主模型需要原文时通过 `read_page_content`
     * 工具按需分页获取。这里只保留身份段与 canonical/domain 元信息。
     */
    identityTitle?: string;
    identityId?: string;
    /** v0.2 新增：归一化 canonical URL（若可用），用于 WorkingMemory / Episodic 索引 */
    canonicalUrl?: string;
    /** v0.2 新增：域名（extractDomain(canonicalUrl)） */
    domain?: string;
  };
  /** 用户在输入框中插入的引用 tag 序列化文本（带 <ref> 标签） */
  references?: string;
  /**
   * v0.2 新增：当前活跃的 PageVisit id。
   * 由 sidebar 在调用 Agent 前从 PageVisitManager 取出注入。
   */
  visitId?: string;
  /** 外部运行时数据（如记忆层召回所需的额外参数） */
  runtime?: Record<string, unknown>;
}

/** ContextSource 产出的一段内容 */
export interface ContextSegment {
  /** 来源 source 名称 */
  source: string;
  /** 映射为一条 ChatMessage（通常是 system / user） */
  message: ChatMessage;
}

export interface ContextSource {
  readonly name: string;
  /** 数字越大越优先（排在 messages 越靠前） */
  readonly priority: number;
  /** 返回 null 表示本轮不贡献段落 */
  gather(ctx: AgentInvokeContext): Promise<ContextSegment | null>;
}
