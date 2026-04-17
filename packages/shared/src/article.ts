/**
 * 页面与文章相关的通用类型
 * ---------------------------------------------
 * Tools 层的 Identity/Content pipeline 使用这些类型作为输入/输出契约。
 */

/** 页面上下文：Identity/Content pipeline 的共同输入 */
export interface PageContext {
  /** document.URL */
  url: string;
  /** document.title */
  title: string;
  /** 当前 Document 对象（浏览器环境），测试时可以传 happy-dom 构造的 Document */
  document: Document;
  /** 可选：用户当前选区的纯文本 */
  selectionText?: string;
  /** 可选：语言（document.documentElement.lang） */
  lang?: string;
}

/** 文章身份：用于会话绑定（MVP 不做持久化，Phase 2 作为 memory key） */
export interface ArticleIdentity {
  /** 稳定的唯一标识（不会随滚动等操作变化） */
  id: string;
  title: string;
  url: string;
  /** 识别此身份的策略名，便于调试 */
  source: string;
}

/** 文章主体：注入给 LLM 的上下文原料 */
export interface ExtractedContent {
  title: string;
  /** 主体内容，MVP 为纯文本；Phase 2 可扩展 Markdown */
  content: string;
  /** 摘要或开头前 N 字，便于快速注入 */
  excerpt: string;
  /** 字符数（MVP 不做 token 计数） */
  charCount: number;
  /** 产出此内容的提取器名 */
  extractor: string;
}
