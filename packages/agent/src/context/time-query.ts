/**
 * time-query util · 时间维元查询识别 + 时间窗解析
 * ---------------------------------------------
 * v0.4.0 · 作为 Chronological Index 的**共享基建**，被三处调用：
 *   1) `list_recent_visits` tool 的 runner（把 timeRange 解析成 [start, end] 毫秒窗口）
 *   2) `recall_memory` 的 `timeRange` 二次过滤（向量召回之后再按窗口筛）
 *   3) `RelevantMemorySource` 的自动路由分支（user 输入命中时间维元查询 → 跳过向量、直接按窗口注入清单）
 *
 * 设计要点：
 *   - 纯工具层：零副作用、零异步、零 LLM 依赖，可以在任意位置调用
 *   - 放在 `packages/agent` 而非 `packages/tools`，避免 agent 反向依赖 tools
 *   - `detectTimeScopedMetaQuery` 的判断策略是**保守**的：要求同时出现"时间锚点 + 列举/元查询动词"，
 *     只 catch 高置信场景，避免误伤"上次那个方案"这种正常语义召回线索
 */

/** 时间窗口键；'custom' 要求调用方额外提供 startTs/endTs */
export type TimeRangeKey =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'last-week'
  | 'last-7-days'
  | 'custom';

/**
 * 判断 query 是否是"时间维元查询"（现有语义召回无法处理）。
 * 特征：同时出现"时间锚点词"与"列举/查询词"。
 *
 * 纯正则判断，零 LLM 调用、零延迟。匹配保守——只 catch 高置信场景，避免误伤
 * "上次我们聊的那个方案"这种正常召回请求。
 */
export function detectTimeScopedMetaQuery(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  // 时间锚点：今天/昨天/前天/本周/上周/本月/最近 N 天/过去 N 小时/这几天 等
  const TIME_ANCHOR = [
    '今天',
    '昨天',
    '前天',
    '本周',
    '上周',
    '这周',
    '这几天',
    '本月',
    '上个月',
    '最近',
    '刚刚',
    '今早',
    '今晚',
    '下午',
    '晚上',
    'today',
    'yesterday',
    'this week',
    'last week',
    'this month',
    'recently',
  ];
  // 列举/元查询词：看了/读了/聊了/做了/哪些/什么（通常跟在"X 了"后面）/有哪些
  const META_QUERY = [
    '看了哪',
    '看了什么',
    '读了哪',
    '读了什么',
    '聊了哪',
    '聊了什么',
    '讨论了',
    '问过',
    '做了什么',
    '做了哪',
    '有哪些',
    '都看过',
    '都聊过',
    '都读过',
    'what did',
    'which articles',
    'list.*articles',
  ];
  const lower = q.toLowerCase();
  const hasAnchor = TIME_ANCHOR.some((k) => lower.includes(k.toLowerCase()));
  if (!hasAnchor) return false;
  const hasMeta = META_QUERY.some((k) => {
    if (k.includes('.*')) return new RegExp(k, 'i').test(lower);
    return lower.includes(k.toLowerCase());
  });
  return hasMeta;
}

/** 给 `resolveTimeRange` 的可选参数 */
export interface ResolveTimeRangeOptions {
  /** custom 模式的起点（毫秒） */
  startTs?: number;
  /** custom 模式的终点（毫秒） */
  endTs?: number;
  /** 时间源注入（单测用），默认 `Date.now()` */
  now?: number;
}

/**
 * 将 `TimeRangeKey` 解析为 `[startTs, endTs]` 毫秒窗口。
 *
 * 约定：
 *   - today / yesterday：以**本地时区**的 00:00:00 为界
 *   - this-week：本地周一 00:00:00 ~ 下周一 00:00:00（Monday-start，符合中文周习惯）
 *   - last-week：上周一 00:00:00 ~ 本周一 00:00:00
 *   - last-7-days：now - 7d ~ now（滑动窗口，不对齐 0 点）
 *   - custom：直接使用 `opts.startTs` / `opts.endTs`，缺一即抛错
 */
export function resolveTimeRange(
  timeRange: TimeRangeKey,
  opts: ResolveTimeRangeOptions = {},
): { startTs: number; endTs: number } {
  const now = opts.now ?? Date.now();

  if (timeRange === 'custom') {
    if (opts.startTs === undefined || opts.endTs === undefined) {
      throw new Error('resolveTimeRange: custom 模式必须提供 startTs 与 endTs');
    }
    if (opts.endTs < opts.startTs) {
      throw new Error('resolveTimeRange: custom 模式 endTs 必须不小于 startTs');
    }
    return { startTs: opts.startTs, endTs: opts.endTs };
  }

  const nowDate = new Date(now);

  // 本地 00:00 起点
  const startOfToday = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  switch (timeRange) {
    case 'today':
      return { startTs: startOfToday, endTs: startOfToday + MS_PER_DAY };
    case 'yesterday':
      return { startTs: startOfToday - MS_PER_DAY, endTs: startOfToday };
    case 'this-week': {
      // Monday-start：JS getDay()=0 表示周日；把它映射成 7，使得周一=1
      const dow = nowDate.getDay() === 0 ? 7 : nowDate.getDay();
      const mondayStart = startOfToday - (dow - 1) * MS_PER_DAY;
      return { startTs: mondayStart, endTs: mondayStart + 7 * MS_PER_DAY };
    }
    case 'last-week': {
      const dow = nowDate.getDay() === 0 ? 7 : nowDate.getDay();
      const mondayStart = startOfToday - (dow - 1) * MS_PER_DAY;
      return {
        startTs: mondayStart - 7 * MS_PER_DAY,
        endTs: mondayStart,
      };
    }
    case 'last-7-days':
      return { startTs: now - 7 * MS_PER_DAY, endTs: now };
    default: {
      // 类型穷尽兜底
      const _: never = timeRange;
      throw new Error(`resolveTimeRange: 未知 timeRange=${String(_)}`);
    }
  }
}
