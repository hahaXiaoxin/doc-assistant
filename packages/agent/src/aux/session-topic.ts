/**
 * identifySessionTopic · 每 N 轮触发一次"主题识别"
 * ---------------------------------------------
 * v0.2.1 · 与 SessionTopicSource（priority=55）配对：
 * - Source 负责"读"：把已有 currentTopic 注入 system prompt。
 * - 本模块负责"写"：根据最近几轮 user/assistant 消息，交给辅助 LLM 产出
 *   `{ currentTopic, tags, stage }`，并落库到 `memory.setSessionTopic()`。
 *
 * 触发频率：
 * - 默认每 4 轮 user 消息识别一次（见 `shouldIdentify`）；
 * - 可通过 memory.SessionTopicRecord.history.length 避免短时间内重复识别（由调用方判断）。
 *
 * 失败降级：
 * - 辅 LLM 调用失败 → 仅记日志，不写入 memory，不影响主对话。
 * - 解析失败 → 同上；调用方据 `status='skipped'` 判断是否跳过。
 *
 * 解析器宽松规则：
 * - 优先按 JSON；解析失败则按 `TOPIC: ... TAGS: a,b,c STAGE: ...` 行扫描。
 * - 若 `currentTopic` 为空 → 视为跳过（不写库）。
 */
import type { LLMProvider } from '@doc-assistant/provider';
import type { ChatMessage } from '@doc-assistant/shared';
import type {
  MemoryStore,
  SessionTopicRecord,
  TopicStage,
} from '@doc-assistant/memory';
import { createLogger } from '@doc-assistant/shared';
import { collectText } from './collect-text';

const logger = createLogger('agent:aux:session-topic');

export interface IdentifySessionTopicInput {
  aux: LLMProvider;
  memory: Pick<MemoryStore, 'setSessionTopic' | 'getSessionTopic'>;
  visitId: string;
  canonicalUrl?: string;
  articleId?: string;
  /** 最近几轮对话消息（按时间升序），建议取最近 6-10 条 */
  recentMessages: ChatMessage[];
  /** 外部 AbortSignal */
  signal?: AbortSignal;
  /** 超时（毫秒），默认 10_000 */
  timeoutMs?: number;
  /** 时间注入（单测用） */
  getNow?: () => number;
}

export type IdentifyStatus = 'written' | 'skipped' | 'failed';

export interface IdentifySessionTopicResult {
  status: IdentifyStatus;
  record?: SessionTopicRecord;
  reason?: string;
}

/**
 * v0.4.0 · 话题漂移关键词触发
 * ---------------------------------------------------------------
 * 用户在 2~3 轮内明确表达"换个话题"时，若还等 interval=4 周期才识别，
 * 中间几轮会注入旧话题；命中以下高置信漂移信号词 → 立即触发 identify。
 *
 * 仅关键词正则触发，不算 embedding、不调 aux（那些留给 v0.5 完整版）。
 */
const TOPIC_DRIFT_PATTERNS: ReadonlyArray<RegExp> = [
  /换个话题|换话题|转个方向|不聊这个了|不说这个|聊点别的|说点别的|不如说|另外聊|另一个话题|来聊聊|我们聊聊/,
  /\b(let'?s\s+(switch|change|talk\s+about)|switch\s+topic|new\s+topic|change\s+(the\s+)?(topic|subject)|different\s+topic)\b/i,
];

/** 导出以便单测复用（不建议外部业务引用）。 */
export function matchTopicDrift(text: string | undefined | null): boolean {
  if (!text) return false;
  return TOPIC_DRIFT_PATTERNS.some((re) => re.test(text));
}

export interface ShouldIdentifyOptions {
  /** 触发周期（user 消息条数），默认 4。 */
  interval?: number;
  /** 最近一条 user 消息内容；命中漂移关键词会立即返回 true（v0.4.0）。 */
  latestUserInput?: string | undefined;
}

/**
 * 触发策略：
 * - 首条 user 消息即触发（冷启动立刻识别当前话题）；
 * - 之后每 `interval` 条触发一次；
 * - v0.4.0 新增：`latestUserInput` 命中话题漂移关键词 → 即使未到周期也立即触发。
 */
export function shouldIdentify(
  userMsgCount: number,
  opts: ShouldIdentifyOptions = {},
): boolean {
  const { interval = 4, latestUserInput } = opts;
  if (userMsgCount <= 0) return false;
  if (userMsgCount === 1) return true;
  if (matchTopicDrift(latestUserInput)) return true;
  return userMsgCount % interval === 0;
}

const SYSTEM_PROMPT = `你是一个对话主题识别助手。根据用户与助手的最近几轮对话内容，
请用一句话（不超过 24 字）概括当前对话聚焦的主题，并给出 3-5 个关键词标签与对话阶段。
严格按以下 JSON 输出，不要任何额外解释：
{"currentTopic": "...", "tags": ["..."], "stage": "exploring" | "questioning" | "summarizing"}

要求：
- currentTopic 要具体、可判断，不要空话（如"用户提问"）；
- tags 尽量为名词短语；
- stage：exploring=刚开始探索 / questioning=在追问细节 / summarizing=在总结整理。`;

export async function identifySessionTopic(
  input: IdentifySessionTopicInput,
): Promise<IdentifySessionTopicResult> {
  const {
    aux,
    memory,
    visitId,
    canonicalUrl,
    articleId,
    recentMessages,
    signal,
    timeoutMs = 10_000,
    getNow = Date.now,
  } = input;

  if (!recentMessages.length) {
    return { status: 'skipped', reason: 'no recent messages' };
  }

  // 压缩历史：每条最多 200 字
  const historyText = recentMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${(m.content ?? '').slice(0, 200)}`)
    .join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `最近对话：\n${historyText}` },
    ];
    const stream = aux.chat({
      messages,
      signal: controller.signal,
      temperature: 0.3,
    });
    const raw = await collectText(stream, {
      label: 'aux-session-topic',
      maxChars: 400,
      signal: controller.signal,
    });
    const parsed = parseSessionTopicOutput(raw);
    if (!parsed || !parsed.currentTopic.trim()) {
      return { status: 'skipped', reason: 'empty topic' };
    }

    // 读已有记录以保留 history 审计
    const existing = await memory.getSessionTopic(visitId);
    const now = getNow();
    const record: SessionTopicRecord = {
      visitId,
      currentTopic: parsed.currentTopic,
      tags: parsed.tags,
      updatedAt: now,
      history: [
        ...(existing?.history ?? []),
        { at: now, topic: parsed.currentTopic, triggeredBy: 'auto' as const },
      ].slice(-20), // 最多保留 20 条审计
      ...(existing?.canonicalUrl !== undefined
        ? { canonicalUrl: existing.canonicalUrl }
        : canonicalUrl !== undefined
          ? { canonicalUrl }
          : {}),
      ...(existing?.articleId !== undefined
        ? { articleId: existing.articleId }
        : articleId !== undefined
          ? { articleId }
          : {}),
      ...(parsed.stage !== undefined ? { stage: parsed.stage } : {}),
    };
    await memory.setSessionTopic(record);
    logger.info('SessionTopic 已更新', {
      visitId,
      topic: parsed.currentTopic,
      stage: parsed.stage,
    });
    return { status: 'written', record };
  } catch (err) {
    logger.warn('identifySessionTopic 失败', (err as Error).message);
    return { status: 'failed', reason: (err as Error).message };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

interface ParsedTopic {
  currentTopic: string;
  tags: string[];
  stage?: TopicStage;
}

/** 宽松解析 aux 输出：先 JSON，再行扫描。 */
export function parseSessionTopicOutput(raw: string): ParsedTopic | null {
  // 1) 尝试截取首个 `{...}` 作为 JSON
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    const jsonSlice = raw.slice(braceStart, braceEnd + 1);
    try {
      const obj = JSON.parse(jsonSlice) as Record<string, unknown>;
      const currentTopic =
        typeof obj.currentTopic === 'string'
          ? obj.currentTopic.trim()
          : typeof obj.topic === 'string'
            ? (obj.topic as string).trim()
            : '';
      const tags = Array.isArray(obj.tags)
        ? obj.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : [];
      const stage = normalizeStage(obj.stage);
      if (currentTopic) {
        const parsed: ParsedTopic = { currentTopic, tags };
        if (stage) parsed.stage = stage;
        return parsed;
      }
    } catch {
      // 继续走行扫描
    }
  }

  // 2) 行扫描回退
  const topicLine = raw.match(/^\s*topic\s*[:=]\s*(.+)$/im);
  if (topicLine?.[1]) {
    const currentTopic = topicLine[1].trim();
    const tagsLine = raw.match(/^\s*tags?\s*[:=]\s*(.+)$/im);
    const tags = tagsLine?.[1]
      ? tagsLine[1]
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const stageLine = raw.match(/^\s*stage\s*[:=]\s*(\w+)/im);
    const stage = stageLine?.[1] ? normalizeStage(stageLine[1]) : undefined;
    const parsed: ParsedTopic = { currentTopic, tags };
    if (stage) parsed.stage = stage;
    return parsed;
  }

  return null;
}

function normalizeStage(v: unknown): TopicStage | undefined {
  if (typeof v !== 'string') return undefined;
  const norm = v.trim().toLowerCase();
  if (norm === 'exploring' || norm === 'questioning' || norm === 'summarizing') {
    return norm;
  }
  return undefined;
}
