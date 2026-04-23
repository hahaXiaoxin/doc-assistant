/**
 * recall-triggers · 召回链路的"代码粗判"环节
 * ---------------------------------------------
 * 职责：对用户输入做轻量级正则扫描，判断是否"可能在唤起过去对话"。
 * - 命中 → 后续链路（aux-intent 精判 + 向量召回）才会启动。
 * - 未命中 → 直接跳过，节省一次 aux LLM 调用。
 *
 * 设计原则：
 * - 宁可误报（多问一次 aux），不可漏报（导致真的该召回时没走）；
 * - 模式必须是"中文 + 英文"的混合口语，因为用户习惯混用；
 * - 不需要 100% 准确 —— 后面还有 aux 精判兜底。
 *
 * 一旦用户输入是空格/标点 → 直接返回 false。
 */

/** 中文/英文口语化"唤起过去"的关键模式 */
const RECALL_PATTERNS: ReadonlyArray<RegExp> = [
  // 中文时间线索
  /上次|上一次|之前|前几天|前两天|昨天|前天|刚才|刚刚/,
  // 中文记忆线索
  /还记得|记不记得|我们聊过|我们讨论过|我们说过|你说过|我说过|提过|提到过/,
  // 中文引用过去
  /那篇|那段|那个话题|那个讨论|之前那|上次那|之前说的|之前聊的/,
  // 英文时间线索
  /\b(?:last time|previously|earlier|the other day|yesterday)\b/i,
  // 英文记忆线索
  /\b(?:do you remember|remember when|we talked about|we discussed|you said|i said)\b/i,
  // 英文引用
  /\b(?:that article|that topic|that discussion|what we said)\b/i,
];

export interface RecallTriggerResult {
  hit: boolean;
  /** 首个命中的正则（用于调试/审计） */
  matchedPattern?: string;
  /** 命中的关键片段（截断到 60 字），供日志/aux prompt 使用 */
  matchedText?: string;
}

export function detectRecallTrigger(userInput: string): RecallTriggerResult {
  const trimmed = (userInput ?? '').trim();
  if (!trimmed) return { hit: false };

  for (const re of RECALL_PATTERNS) {
    const m = trimmed.match(re);
    if (m) {
      return {
        hit: true,
        matchedPattern: re.source,
        matchedText: m[0].slice(0, 60),
      };
    }
  }
  return { hit: false };
}

/**
 * 构造"最近几轮对话"的简短提示，供 aux-intent 精判使用。
 * 取 history 末尾 N 条 user/assistant 消息，每条 100 字上限。
 */
export function buildRecentHistoryHint(
  history: ReadonlyArray<{ role: string; content?: string }>,
  maxTurns = 3,
): string {
  const filtered = history.filter((m) => m.role === 'user' || m.role === 'assistant');
  const tail = filtered.slice(-maxTurns * 2); // 每轮包含 user+assistant
  return tail
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${(m.content ?? '').slice(0, 100)}`)
    .join('\n');
}
