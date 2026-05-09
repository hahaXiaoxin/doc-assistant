/**
 * PageVisitManager · visit 生命周期管理
 * ---------------------------------------------
 * v0.2 · UI 层持有单例，监听 URL 变化 / /new 命令触发新 visit
 *
 * 职责：
 * - 管理当前活跃 PageVisit（getCurrent）
 * - startNewVisit：新建（结束上一个）
 * - endCurrent：仅结束但不新建（tab 关闭前调用）
 * - onUrlChange：canonicalUrl 变化时自动切新 visit
 * - 可注入 MemoryStore：visit 开始/结束时顺带登记 page_visits 表
 * - 可订阅 visit 切换事件：订阅者会收到新旧 visit，用于触发 WorkingMemory 恢复、
 *   ReflectionTask 登记等后续动作（由订阅者完成，manager 不直接依赖）
 *
 * 架构红线：
 * - 本类**不直接触发**反思 Job / WorkingMemory 恢复；这些是订阅者的责任。
 * - 本类**不持有** Document / chrome.tabs，由调用方注入归一化好的 canonicalUrl。
 */

import { createLogger, canonicalizeUrl, compact, extractDomain } from '@doc-assistant/shared';
import type { MemoryStore } from '@doc-assistant/memory';
import type { PageVisit } from './types';

const logger = createLogger('agent:page-visit');

export interface StartVisitInput {
  /** 用户访问的原始 URL */
  url: string;
  /** 可选：当前 Document（若可用会读取 canonical） */
  doc?: Document | null;
  /** 可选：预归一化好的 canonicalUrl（若 doc 不可用则必须传） */
  canonicalUrl?: string;
  articleId?: string;
  title?: string;
}

export interface PageVisitListener {
  (event: { type: 'start'; visit: PageVisit } | { type: 'end'; visit: PageVisit }): void;
}

export interface PageVisitManagerOptions {
  /** 时间源（测试注入） */
  getNow?: () => number;
  /** id 生成器（测试注入） */
  genId?: () => string;
  /** 可选的 MemoryStore：写 page_visits 表 */
  memory?: MemoryStore;
}

export class PageVisitManager {
  private current: PageVisit | null = null;
  private readonly listeners = new Set<PageVisitListener>();
  private readonly getNow: () => number;
  private readonly genId: () => string;
  private readonly memory: MemoryStore | undefined;

  constructor(opts: PageVisitManagerOptions = {}) {
    this.getNow = opts.getNow ?? (() => Date.now());
    this.genId =
      opts.genId ??
      ((): string => {
        const g = globalThis as { crypto?: { randomUUID?: () => string } };
        if (g.crypto?.randomUUID) return g.crypto.randomUUID();
        return `visit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      });
    if (opts.memory) this.memory = opts.memory;
  }

  /** 订阅 visit 切换事件 */
  subscribe(listener: PageVisitListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 当前活跃 visit（未 end） */
  getCurrent(): PageVisit | null {
    return this.current;
  }

  /**
   * 开始新 visit（若已有活跃 visit 则先 end）。
   * 返回新 visit。
   */
  async startNewVisit(input: StartVisitInput): Promise<PageVisit> {
    if (this.current && !this.current.endedAt) {
      await this.endCurrent();
    }
    const canonicalUrl = input.canonicalUrl ?? canonicalizeUrl(input.doc ?? null, input.url);
    const domain = extractDomain(canonicalUrl);
    const visit: PageVisit = {
      visitId: this.genId(),
      startedAt: this.getNow(),
      url: input.url,
      canonicalUrl,
      domain,
      ...compact({ articleId: input.articleId, title: input.title }),
    };
    this.current = visit;
    logger.info('startNewVisit', {
      visitId: visit.visitId,
      canonicalUrl,
      domain,
      articleId: visit.articleId,
    });
    // 登记到 page_visits（失败容忍）
    if (this.memory) {
      this.memory.recordPageVisit(visit).catch((err: Error) => {
        logger.warn('recordPageVisit 失败（不阻塞 visit 启动）', err.message);
      });
    }
    this.emit({ type: 'start', visit });
    return visit;
  }

  /**
   * 结束当前 visit（不新建）。
   * 常用场景：tab 关闭前 / /new 前的显式收尾。
   */
  async endCurrent(): Promise<PageVisit | null> {
    if (!this.current || this.current.endedAt) return this.current;
    const ended: PageVisit = { ...this.current, endedAt: this.getNow() };
    this.current = ended;
    logger.info('endCurrent', { visitId: ended.visitId, durationMs: ended.endedAt! - ended.startedAt });
    if (this.memory) {
      this.memory.recordPageVisit(ended).catch((err: Error) => {
        logger.warn('recordPageVisit(end) 失败（不阻塞）', err.message);
      });
    }
    this.emit({ type: 'end', visit: ended });
    return ended;
  }

  /**
   * URL 变化触发：canonicalUrl 不变 → 不切 visit；变了 → 新 visit。
   * @returns 新 visit（若切换），否则返回当前 visit。
   */
  async onUrlChange(input: StartVisitInput): Promise<PageVisit> {
    const newCanonical = input.canonicalUrl ?? canonicalizeUrl(input.doc ?? null, input.url);
    if (this.current && !this.current.endedAt && this.current.canonicalUrl === newCanonical) {
      // 同一 canonical，只更新 articleId/title（若提供了更好的值）
      if (input.articleId && !this.current.articleId) {
        this.current = { ...this.current, articleId: input.articleId };
      }
      if (input.title && !this.current.title) {
        this.current = { ...this.current, title: input.title };
      }
      return this.current;
    }
    return this.startNewVisit(input);
  }

  /**
   * /new 命令：强制结束当前 visit 并新开一个（同一 canonicalUrl）。
   * WorkingMemory / Persona / Episodic 不清（见 ROADMAP §命令语义）。
   */
  async onNewCommand(input?: StartVisitInput): Promise<PageVisit> {
    // 用当前 visit 的 URL 信息作为默认值
    const fallback: StartVisitInput = {
      url: input?.url ?? this.current?.url ?? '',
      ...compact({
        canonicalUrl: input?.canonicalUrl ?? this.current?.canonicalUrl,
        articleId: input?.articleId ?? this.current?.articleId,
        title: input?.title ?? this.current?.title,
        doc: input?.doc,
      }),
    };
    return this.startNewVisit(fallback);
  }

  private emit(event: Parameters<PageVisitListener>[0]): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        logger.warn('PageVisit listener 抛异常（已吞）', (err as Error).message);
      }
    }
  }
}
