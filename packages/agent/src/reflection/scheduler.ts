/**
 * ReflectionScheduler · 反思任务的调度与补跑
 * ---------------------------------------------
 * v0.2.1 · 职责：
 * - `runPending()`：从 `memory.listPendingReflections()` 取出 N 条，逐个交给 ReflectionRunner 跑。
 *   成功 → `updateReflection({ status:'done', completedAt })`
 *   失败 → `updateReflection({ status:'pending'|'failed', attemptsCount++, lastError })`
 *     · attemptsCount >= maxAttempts 时置 `failed`；否则保持 `pending` 以便下次补跑。
 * - `registerOnPageVisitEnd(manager)`：订阅 PageVisit 结束事件，登记 3 条反思任务并尝试立即跑。
 *
 * 调用方负责**何时**触发 `runPending()`。当前 v0.2.1 策略：
 * - Sidebar 启动完成后调一次（idle 补跑）；
 * - `chrome.alarms` 每 60 分钟广播 `reflection-scan` 事件；sidebar 在线时响应一次。
 *
 * 并发控制：通过内部 `running` 标志位避免多路并发同时扫。
 */
import type { PageVisitManager } from '../page-visit/manager';
import type { ReflectionRunner } from './runner';
import type {
  MemoryStore,
  ReflectionTask,
  ReflectionTaskType,
} from '@doc-assistant/memory';
import { createLogger } from '@doc-assistant/shared';

const logger = createLogger('agent:reflection:scheduler');

export interface ReflectionSchedulerOptions {
  memory: MemoryStore;
  runner: ReflectionRunner;
  /** 单次 runPending 最多跑多少条（防止一轮扫得太久） */
  maxTasksPerRun?: number;
  /** 失败重试上限（与 DexieMemoryStore.listPendingReflections 保持一致） */
  maxAttempts?: number;
  getNow?: () => number;
}

export interface RunPendingResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

const DEFAULT_TASK_TYPES: ReflectionTaskType[] = [
  'visit_summary',
  'persona_extraction',
  'persona_conflict_check',
];

export class ReflectionScheduler {
  private readonly memory: MemoryStore;
  private readonly runner: ReflectionRunner;
  private readonly maxTasksPerRun: number;
  private readonly maxAttempts: number;
  private readonly getNow: () => number;
  private running = false;

  constructor(opts: ReflectionSchedulerOptions) {
    this.memory = opts.memory;
    this.runner = opts.runner;
    this.maxTasksPerRun = opts.maxTasksPerRun ?? 6;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.getNow = opts.getNow ?? ((): number => Date.now());
  }

  /**
   * 扫一次 pending 并逐个执行（串行，避免 aux/embedding 并发爆量）。
   * 不抛错：任何异常都记日志并降级为 skipped。
   */
  async runPending(): Promise<RunPendingResult> {
    if (this.running) {
      logger.info('runPending 已在运行，跳过本次调度');
      return { total: 0, succeeded: 0, failed: 0, skipped: 0 };
    }
    this.running = true;
    try {
      const pending = await this.memory.listPendingReflections(this.maxAttempts);
      const batch = pending.slice(0, this.maxTasksPerRun);
      if (batch.length === 0) {
        return { total: 0, succeeded: 0, failed: 0, skipped: 0 };
      }

      logger.info(`runPending 开始：${batch.length}/${pending.length} 条任务（本轮上限 ${this.maxTasksPerRun}）`);

      let succeeded = 0;
      let failed = 0;
      let skipped = 0;

      for (const task of batch) {
        try {
          // 标记 running（可选，便于外部审计）
          await this.memory.updateReflection(task.id, { status: 'running' });
          const outcome = await this.runner.run(task);
          if (outcome.ok) {
            await this.memory.updateReflection(task.id, {
              status: 'done',
              completedAt: this.getNow(),
            });
            succeeded += 1;
          } else {
            const nextAttempts = task.attemptsCount + 1;
            const reachMax = nextAttempts >= this.maxAttempts;
            await this.memory.updateReflection(task.id, {
              status: reachMax ? 'failed' : 'pending',
              attemptsCount: nextAttempts,
              lastError: outcome.error.slice(0, 500),
            });
            if (reachMax) failed += 1;
            else skipped += 1;
            logger.warn(`任务 ${task.id} (${task.taskType}) 失败 attempt=${nextAttempts}/${this.maxAttempts}`, outcome.error);
          }
        } catch (err) {
          // 执行器本身抛错（不该发生——runner 内部全部 catch 了）
          const nextAttempts = task.attemptsCount + 1;
          const reachMax = nextAttempts >= this.maxAttempts;
          await this.memory.updateReflection(task.id, {
            status: reachMax ? 'failed' : 'pending',
            attemptsCount: nextAttempts,
            lastError: (err as Error).message.slice(0, 500),
          });
          if (reachMax) failed += 1;
          else skipped += 1;
          logger.error(`ReflectionRunner 抛未捕获异常（任务 ${task.id}）`, (err as Error).message);
        }
      }

      const result: RunPendingResult = {
        total: batch.length,
        succeeded,
        failed,
        skipped,
      };
      logger.info('runPending 完成', result);
      return result;
    } finally {
      this.running = false;
    }
  }

  /**
   * 订阅 PageVisit 结束：
   * - 立即登记 3 条反思任务；
   * - 当场尝试跑一次（fire-and-forget）。
   * 返回 unsubscribe 函数。
   */
  registerOnPageVisitEnd(
    manager: PageVisitManager,
    taskTypes: ReflectionTaskType[] = DEFAULT_TASK_TYPES,
  ): () => void {
    return manager.subscribe((event) => {
      if (event.type !== 'end') return;
      void this.enqueueForVisit(event.visit.visitId, taskTypes).then(() => {
        void this.runPending();
      });
    });
  }

  /** 给定 visitId，为每个 taskType 登记一条（幂等：按 visitId+taskType 去重依赖底层表主键，暂不做） */
  async enqueueForVisit(
    visitId: string,
    taskTypes: ReflectionTaskType[] = DEFAULT_TASK_TYPES,
  ): Promise<ReflectionTask[]> {
    const results: ReflectionTask[] = [];
    for (const taskType of taskTypes) {
      try {
        const t = await this.memory.enqueueReflection({ visitId, taskType });
        results.push(t);
      } catch (err) {
        logger.warn(`enqueueReflection 失败 (${taskType})`, (err as Error).message);
      }
    }
    logger.info(`PageVisit ${visitId} 结束 → 登记 ${results.length} 条反思任务`);
    return results;
  }
}
