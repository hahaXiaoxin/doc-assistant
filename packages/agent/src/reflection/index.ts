/**
 * @doc-assistant/agent · reflection 子模块
 * ---------------------------------------------
 * v0.2.1 · PageVisit 结束后的异步反思机制。
 */
export {
  ReflectionRunner,
  parseSummaryOutput,
  parsePersonaOutput,
  type ReflectionRunnerDeps,
  type ReflectionRunOutcome,
  type ParsedPersonaCandidate,
} from './runner';
export {
  ReflectionScheduler,
  type ReflectionSchedulerOptions,
  type RunPendingResult,
} from './scheduler';
