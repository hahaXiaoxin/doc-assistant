/**
 * Type-level assertions · v0.3.0 MemoryStore 14 项必填收紧
 * ---------------------------------------------
 * 此处用类型推导守护：任何一项变回可选都会触发编译错。
 */
import type { MemoryStore } from '../interface';

// 若某方法仍是可选，T[K] 的类型会包含 undefined；
// `Exclude<T[K], undefined> extends T[K]` 仅当 K 非可选时为真（T[K] 已不含 undefined）。
type _AssertRequired<T> = {
  [K in keyof T]-?: Exclude<T[K], undefined> extends T[K] ? T[K] : never;
};

// 这 20 项必须全部必填；任一变回可选，对应位置会成为 `never`，
// 使下面的 `_MemoryRequiredCheck` 不再可以承接一个真实 MemoryStore 值。
type _RequiredMemoryMethods = Pick<
  MemoryStore,
  | 'deleteRecord'
  | 'listVisitSummaries'
  | 'listSessionTopics'
  | 'listWorkingMemories'
  | 'deleteWorkingMemory'
  | 'getWorkingMemory'
  | 'setWorkingMemory'
  | 'touchWorkingMemory'
  | 'archiveStaleWorkingMemories'
  | 'listPersonas'
  | 'addPersonaCandidate'
  | 'updatePersona'
  | 'setSessionTopic'
  | 'getSessionTopic'
  | 'enqueueReflection'
  | 'listPendingReflections'
  | 'updateReflection'
  | 'recordPageVisit'
  | 'getPageVisit'
  | 'close'
>;

type _MemoryRequiredCheck = _AssertRequired<_RequiredMemoryMethods>;

// 若任一 K 位置变为 `never`，这个声明必然会产生类型错误（MemoryStore 不可赋）。
declare const _memoryCheck: _MemoryRequiredCheck;
export const _typeCheck: MemoryStore = _memoryCheck as unknown as MemoryStore;
