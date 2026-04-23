/**
 * callAuxIntent · 判断用户消息是否在"唤起过去对话"
 * ---------------------------------------------
 * 召回链上的"精判"环节：
 *   代码关键词粗判（recall-triggers）→ **本函数 aux 精判** → 向量召回 top-K
 *
 * 为什么需要精判：
 * - 关键词粗判会误报，比如用户说"前几天天气不错"只是闲聊不需要召回。
 * - 用一个便宜的辅助 LLM 回答 yes/no，用 yes-rate * top-K 命中率衡量价值。
 *
 * 契约：
 * - 输入：当前用户消息（最多 200 字）+ 可选的最近 N 条 history 摘要。
 * - 输出：`{ intent: 'yes' | 'no', confidence: number, raw: string }`。
 * - 错误：网络/Schema 错误时返回 `{ intent: 'no', confidence: 0, raw: '' }` 而不是抛错——
 *   因为精判只是优化手段，失败时应降级为"不召回"而非让主对话中断。
 *
 * 提示词设计要点：
 * - system 明确要求 `仅输出 yes 或 no`；再要一个可选的 0-1 置信度。
 * - 输出解析宽松：匹配首个 `yes`/`no` 关键字；置信度匹配 `conf:0.x` 或 `\d+(\.\d+)?` 介于 0-1。
 */
import type { LLMProvider } from '@doc-assistant/provider';
import type { ChatMessage } from '@doc-assistant/shared';
import { createLogger } from '@doc-assistant/shared';
import { collectText } from './collect-text';

const logger = createLogger('agent:aux:intent');

export interface AuxIntentInput {
  /** 当前用户原始输入（未经 ref 序列化） */
  userMessage: string;
  /** 最近 N 条 history 的简要拼接（可选，帮助 aux 判断） */
  recentHistoryHint?: string;
  /** 调用超时（毫秒），默认 8000 */
  timeoutMs?: number;
  /** 外部 AbortSignal */
  signal?: AbortSignal;
}

export interface AuxIntentResult {
  intent: 'yes' | 'no';
  /** 0-1；解析不到时为 0.5 */
  confidence: number;
  /** aux 原始输出（用于调试/审计） */
  raw: string;
}

const SYSTEM_PROMPT = `你是一个"意图分类"助手。
给你一条用户刚发出的消息；你的任务是判断：这条消息是否在"唤起过去的对话/长期记忆"——例如
  - 提到"上次/之前/昨天/前几天/还记得/我们聊过"等；
  - 明确指向"之前看的/之前讨论的"某个主题；
  - 需要回顾历史事实才能回答。

只需要回答一个词 yes 或 no，以及一个 0-1 的置信度；格式严格按：
ANSWER: <yes|no>
CONFIDENCE: <0-1 之间的小数>

不要输出任何其它解释。`;

export async function callAuxIntent(
  aux: LLMProvider,
  input: AuxIntentInput,
): Promise<AuxIntentResult> {
  const { userMessage, recentHistoryHint, timeoutMs = 8_000, signal } = input;
  const trimmedUser = userMessage.slice(0, 200).trim();
  if (!trimmedUser) {
    return { intent: 'no', confidence: 0, raw: '' };
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: recentHistoryHint
        ? `最近几轮对话（摘要）：\n${recentHistoryHint}\n\n用户本轮消息：\n${trimmedUser}`
        : `用户消息：\n${trimmedUser}`,
    },
  ];

  // 叠加内部超时与外部 signal
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const stream = aux.chat({
      messages,
      signal: controller.signal,
      temperature: 0,
    });
    const raw = await collectText(stream, {
      label: 'aux-intent',
      maxChars: 120,
      signal: controller.signal,
    });
    return parseIntentOutput(raw);
  } catch (err) {
    logger.warn('aux-intent 调用失败，降级为 no', (err as Error).message);
    return { intent: 'no', confidence: 0, raw: '' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * 宽松解析 aux 输出：
 * - 优先匹配 `ANSWER:\s*(yes|no)`；若没有，就扫全文看哪个先出现。
 * - 置信度匹配 `CONFIDENCE:\s*([01](?:\.\d+)?|0?\.\d+)`；否则 0.5。
 */
export function parseIntentOutput(raw: string): AuxIntentResult {
  const lower = raw.toLowerCase();

  let intent: 'yes' | 'no' = 'no';
  const answerMatch = lower.match(/answer\s*[:=]\s*(yes|no)/);
  if (answerMatch && answerMatch[1]) {
    intent = answerMatch[1] as 'yes' | 'no';
  } else {
    // 回退：看 yes/no 哪个先出现；都没有则 no
    const yesIdx = lower.indexOf('yes');
    const noIdx = lower.indexOf('no');
    if (yesIdx >= 0 && (noIdx < 0 || yesIdx < noIdx)) {
      intent = 'yes';
    }
  }

  let confidence = 0.5;
  const confMatch = lower.match(/confidence\s*[:=]\s*([01](?:\.\d+)?|0?\.\d+)/);
  if (confMatch && confMatch[1]) {
    const n = Number(confMatch[1]);
    if (!Number.isNaN(n) && n >= 0 && n <= 1) confidence = n;
  }

  return { intent, confidence, raw };
}
