/**
 * NullMemoryStore · 空实现
 * ---------------------------------------------
 * 所有方法都是 no-op，用于：
 * - 单测里替代真 Dexie（避免 fake-indexeddb 启动成本）
 * - 扩展启动早期未初始化 IDB 的兜底
 * - 用户禁用记忆层时的替代
 *
 * v0.3：MemoryStore 的可选方法全部改为必填；本类为所有方法提供幂等的 no-op 实现。
 */
import type {
  MemoryRecord,
  MemoryStore,
  RecallQuery,
  PersonaRecord,
  PersonaStatus,
  PersonaSubject,
  SessionTopicRecord,
  WorkingMemoryRecord,
  ReflectionTask,
  ReflectionStatus,
  PageVisitRecord,
} from './interface';
import { compact } from '@doc-assistant/shared';

export class NullMemoryStore implements MemoryStore {
  async remember(_record: MemoryRecord): Promise<void> {
    // no-op
  }

  async recall(_query: RecallQuery): Promise<MemoryRecord[]> {
    return [];
  }

  async deleteRecord(_id: string): Promise<void> {
    // no-op
  }

  async listVisitSummaries(_opts?: {
    timeRange?: [number, number];
    limit?: number;
  }): Promise<MemoryRecord[]> {
    return [];
  }

  async listSessionTopics(_opts?: { limit?: number }): Promise<SessionTopicRecord[]> {
    return [];
  }

  async listWorkingMemories(_opts?: { limit?: number }): Promise<WorkingMemoryRecord[]> {
    return [];
  }

  async deleteWorkingMemory(_canonicalUrl: string): Promise<void> {
    // no-op
  }

  async getWorkingMemory(_canonicalUrl: string): Promise<WorkingMemoryRecord | null> {
    return null;
  }

  async setWorkingMemory(_record: WorkingMemoryRecord): Promise<void> {
    // no-op
  }

  async touchWorkingMemory(_canonicalUrl: string, _at?: number): Promise<void> {
    // no-op
  }

  async archiveStaleWorkingMemories(_ttlMs: number): Promise<number> {
    return 0;
  }

  async listPersonas(_opts?: {
    status?: PersonaStatus;
    subject?: PersonaSubject;
  }): Promise<PersonaRecord[]> {
    return [];
  }

  async addPersonaCandidate(
    candidate: Omit<PersonaRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PersonaRecord> {
    const now = Date.now();
    return {
      ...candidate,
      id: `null-${now}`,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updatePersona(
    _id: string,
    _patch: Partial<PersonaRecord>,
    _reason?: string,
  ): Promise<void> {
    // no-op
  }

  async setSessionTopic(_record: SessionTopicRecord): Promise<void> {
    // no-op
  }

  async getSessionTopic(_visitId: string): Promise<SessionTopicRecord | null> {
    return null;
  }

  async enqueueReflection(
    task: Omit<ReflectionTask, 'id' | 'createdAt' | 'attemptsCount' | 'status'> & {
      id?: string;
      status?: ReflectionStatus;
    },
  ): Promise<ReflectionTask> {
    const now = Date.now();
    return {
      id: task.id ?? `null-${now}`,
      visitId: task.visitId,
      taskType: task.taskType,
      status: task.status ?? 'pending',
      attemptsCount: 0,
      createdAt: now,
      ...compact({ completedAt: task.completedAt, lastError: task.lastError }),
    };
  }

  async listPendingReflections(_maxAttempts?: number): Promise<ReflectionTask[]> {
    return [];
  }

  async updateReflection(
    _id: string,
    _patch: Partial<Pick<ReflectionTask, 'status' | 'attemptsCount' | 'completedAt' | 'lastError'>>,
  ): Promise<void> {
    // no-op
  }

  async recordPageVisit(_visit: PageVisitRecord): Promise<void> {
    // no-op
  }

  async getPageVisit(_visitId: string): Promise<PageVisitRecord | null> {
    return null;
  }

  async close(): Promise<void> {
    // no-op
  }
}
