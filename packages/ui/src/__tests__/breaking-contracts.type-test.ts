/**
 * Type-level assertions · v0.3.0 UI-facing 必填收紧
 * ---------------------------------------------
 * 用 `@ts-expect-error` 守护以下 breaking change：
 * 1. UIMessage.visitId 必填（缺省必须是编译错）
 * 2. SlashCommandContext 5 项新增能力必填
 *
 * 任何一个 @ts-expect-error 若变成无错则 tsc 会报 "Unused '@ts-expect-error'"，
 * 反过来起到"回归保护"的作用。
 */
import type { UIMessage } from '../hooks/useStreamingChat';
import type { SlashCommandContext } from '../commands/types';

/* ------------------------------------------------------------------ */
/* 1. UIMessage.visitId 必填                                           */
/* ------------------------------------------------------------------ */

// 合法：带 visitId
const _msgOk: UIMessage = {
  id: 'm1',
  role: 'user',
  content: 'hi',
  visitId: 'v1',
};
void _msgOk;

// 非法：缺 visitId → 编译错
// @ts-expect-error - UIMessage.visitId 必填
const _msgBad: UIMessage = {
  id: 'm1',
  role: 'user',
  content: 'hi',
};
void _msgBad;

/* ------------------------------------------------------------------ */
/* 2. SlashCommandContext 5 项必填                                      */
/* ------------------------------------------------------------------ */

const _ctxOk: SlashCommandContext = {
  clearConversation: () => {},
  closeMenu: () => {},
  startNewVisit: async () => {},
  triggerRecall: async (_q: string) => {},
  triggerTopicIdentify: async () => {},
  setSessionTopic: async (_t: string) => {},
  appendAssistantNote: (_c: string) => {},
};
void _ctxOk;

// 缺 startNewVisit → 编译错
// @ts-expect-error - startNewVisit 必填
const _ctxNoStartNewVisit: SlashCommandContext = {
  clearConversation: () => {},
  closeMenu: () => {},
  triggerRecall: async () => {},
  triggerTopicIdentify: async () => {},
  setSessionTopic: async () => {},
  appendAssistantNote: () => {},
};
void _ctxNoStartNewVisit;

// 缺 triggerRecall → 编译错
// @ts-expect-error - triggerRecall 必填
const _ctxNoTriggerRecall: SlashCommandContext = {
  clearConversation: () => {},
  closeMenu: () => {},
  startNewVisit: async () => {},
  triggerTopicIdentify: async () => {},
  setSessionTopic: async () => {},
  appendAssistantNote: () => {},
};
void _ctxNoTriggerRecall;

// 缺 triggerTopicIdentify → 编译错
// @ts-expect-error - triggerTopicIdentify 必填
const _ctxNoTriggerTopicIdentify: SlashCommandContext = {
  clearConversation: () => {},
  closeMenu: () => {},
  startNewVisit: async () => {},
  triggerRecall: async () => {},
  setSessionTopic: async () => {},
  appendAssistantNote: () => {},
};
void _ctxNoTriggerTopicIdentify;

// 缺 setSessionTopic → 编译错
// @ts-expect-error - setSessionTopic 必填
const _ctxNoSetSessionTopic: SlashCommandContext = {
  clearConversation: () => {},
  closeMenu: () => {},
  startNewVisit: async () => {},
  triggerRecall: async () => {},
  triggerTopicIdentify: async () => {},
  appendAssistantNote: () => {},
};
void _ctxNoSetSessionTopic;

// 缺 appendAssistantNote → 编译错
// @ts-expect-error - appendAssistantNote 必填
const _ctxNoAppendAssistantNote: SlashCommandContext = {
  clearConversation: () => {},
  closeMenu: () => {},
  startNewVisit: async () => {},
  triggerRecall: async () => {},
  triggerTopicIdentify: async () => {},
  setSessionTopic: async () => {},
};
void _ctxNoAppendAssistantNote;
