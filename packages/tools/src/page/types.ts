/**
 * Page pipeline 接口定义
 * ---------------------------------------------
 * 两个独立的 pipeline：
 * - IdentityStrategy：识别文章身份，产出 ArticleIdentity
 * - ContentExtractor：提取正文，产出 ExtractedContent
 *
 * 两者都按 priority 降序尝试；命中（返回非 null）即返回，不再尝试低优先级。
 *
 * PHASE2: 域名级自学习识别器会注册优先级 100+ 的实例，自动覆盖内置策略。
 */
import type { ArticleIdentity, ExtractedContent, PageContext } from '@doc-assistant/shared';

export interface IdentityStrategy {
  readonly name: string;
  /** 优先级，数字越大越先尝试；内置策略使用 10~70，PHASE2 动态识别器使用 100+ */
  readonly priority: number;
  /** 返回 null 表示本策略放弃 */
  extract(ctx: PageContext): ArticleIdentity | null;
}

export interface ContentExtractor {
  readonly name: string;
  readonly priority: number;
  /** 判断本提取器是否适用当前页面（如 SelectionExtractor 仅在有选区时为 true） */
  canHandle(ctx: PageContext): boolean;
  /** 返回 null 表示提取失败，应交给下一个低优先级 extractor */
  extract(ctx: PageContext): ExtractedContent | null;
}
