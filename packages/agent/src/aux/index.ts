/**
 * 辅助 LLM 调用链（v0.2.1）
 * ---------------------------------------------
 * 统一封装所有"非主对话"的 LLM 调用：
 * - SessionTopic 识别（每 N 轮触发一次）
 * - 召回 Intent 精判（recall 链路的"精判"环节）
 * - （后续）Persona 候选抽取、冲突检测、visit_summary 生成
 *
 * 设计原则：
 * - 所有 aux 调用必须在"失败时降级为不做事"，不得影响主对话；
 * - 统一走 `collectText` 消费流，阻断 tool-call；
 * - 不持有 Provider 实例（由调用方 DI 传入），便于 useMain 复用与独立模型切换。
 */
export { collectText } from './collect-text';
export type { CollectTextOptions } from './collect-text';
export { callAuxIntent, parseIntentOutput } from './intent';
export type { AuxIntentInput, AuxIntentResult } from './intent';
export {
  identifySessionTopic,
  parseSessionTopicOutput,
  shouldIdentify,
} from './session-topic';
export type {
  IdentifySessionTopicInput,
  IdentifySessionTopicResult,
  IdentifyStatus,
} from './session-topic';
