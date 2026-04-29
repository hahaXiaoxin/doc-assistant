/**
 * @doc-assistant/agent · 入口
 * ---------------------------------------------
 * 职责：
 * - 多 Agent 编排（主对话 Agent、未来的 Checker Agent 等）
 * - ContextSource 抽象：每个 Agent 的上下文由多段 Source 组装而成
 * - Tool-calling loop：经典的 LLM + Tool 调用循环
 * - PageVisit 生命周期（v0.2 新增）：UI 边界的统一抽象
 *
 * 架构红线（ESLint 强约束）：
 * - 本包严禁 `import 'ai'` 或 `import '@ai-sdk/*'`
 * - LLM 访问必须通过 @doc-assistant/provider 的 LLMProvider 接口
 */

export { Agent, type AgentOptions } from './agent';
export { AgentOrchestrator } from './orchestrator';
export { runAgentLoop, type LoopOptions } from './loop';
export { createChatAgent, type CreateChatAgentOptions } from './agents/chat-agent';

export {
  buildDefaultMVPSources,
  buildDefaultPhase2_0Sources,
  buildDefaultPhase2_1Sources,
  createSystemPromptSource,
  createChatHistorySource,
  createPersonaSource,
  createSessionTopicSource,
  createWorkingMemorySource,
  createRelevantMemorySource,
  renderRecallMatches,
  recallMemory,
  detectRecallTrigger,
  buildRecentHistoryHint,
  detectTimeScopedMetaQuery,
  resolveTimeRange,
  pageContextSource,
  referenceTagSource,
  type AgentInvokeContext,
  type ContextSegment,
  type ContextSource,
  type DefaultMVPSourcesOptions,
  type DefaultPhase2SourcesOptions,
  type DefaultPhase2_1SourcesOptions,
  type PersonaSourceOptions,
  type RelevantMemorySourceOptions,
  type RecallInput,
  type RecallOutcome,
  type RecallMatch,
  type RecallNeighbor,
  type RecallDeps,
  type RecallMode,
  type RecallTriggerResult,
  type TimeRangeKey,
  type ResolveTimeRangeOptions,
} from './context';

// v0.2: PageVisit 生命周期
export {
  PageVisitManager,
  type PageVisit,
  type PageVisitManagerOptions,
  type PageVisitListener,
  type StartVisitInput,
} from './page-visit';

// v0.2.1: 辅助 LLM 调用链
export {
  collectText,
  callAuxIntent,
  parseIntentOutput,
  identifySessionTopic,
  parseSessionTopicOutput,
  shouldIdentify,
  type CollectTextOptions,
  type AuxIntentInput,
  type AuxIntentResult,
  type IdentifySessionTopicInput,
  type IdentifySessionTopicResult,
  type IdentifyStatus,
} from './aux';

// v0.2.1: 反思任务执行器 + 调度器
export {
  ReflectionRunner,
  ReflectionScheduler,
  parseSummaryOutput,
  parsePersonaOutput,
  type ReflectionRunnerDeps,
  type ReflectionRunOutcome,
  type ReflectionSchedulerOptions,
  type RunPendingResult,
  type ParsedPersonaCandidate,
} from './reflection';
