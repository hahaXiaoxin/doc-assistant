/**
 * PageVisit 类型
 * ---------------------------------------------
 * v0.2 · UI 边界的统一抽象（替代原 session 概念）
 *
 * 设计：
 * - 一次 tab 开→关为一次 PageVisit
 * - 切换 canonicalUrl 或 /new 命令也产生新 visit
 * - visit 本身**不决定对话连续性**：跨 visit 的对话连贯性完全靠记忆召回恢复
 * - 所有消息、反思任务、SessionTopic 都按 visitId 索引
 */

/** 一次 PageVisit 的元数据 */
export interface PageVisit {
  /** 唯一 id：crypto.randomUUID() / 回退到 timestamp+random */
  visitId: string;
  startedAt: number;
  /** 结束时间；未结束时 undefined */
  endedAt?: number;
  /** 用户实际访问的 URL（未归一化） */
  url: string;
  /** 归一化 canonical URL（见 shared.canonicalizeUrl） */
  canonicalUrl: string;
  /** identity pipeline 识别出的 articleId（可能 undefined） */
  articleId?: string;
  /** 域名（extractDomain(canonicalUrl)） */
  domain: string;
  /** 页面标题 */
  title?: string;
}
