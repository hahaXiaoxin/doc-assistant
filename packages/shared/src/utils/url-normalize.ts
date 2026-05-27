/**
 * URL 归一化工具
 * ---------------------------------------------
 * v0.2 · 记忆层的统一"文章身份键"生成器
 *
 * 设计原则（见 docs/ROADMAP.md §2 "URL 归一化"）：
 * - canonical URL 优先：读 `<link rel="canonical">` / `og:url` / `twitter:url`
 * - 回退策略：原始 URL 剥离 UTM 家族 + fbclid + gclid → 去 hash → 去结尾斜杠
 * - 纯函数，无副作用，便于单测
 *
 * 工作/事件/情景三层记忆的 `canonicalUrl` 索引键必须走本模块生成，
 * 避免"同一篇文章被不同 URL 变体拆成多条"。
 */

/** 匹配追踪参数的前缀/名称（忽略大小写） */
const TRACKING_PARAM_PATTERNS: Array<RegExp | string> = [
  /^utm_/i, // utm_source / utm_medium / utm_campaign / ...
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'mc_cid',
  'mc_eid',
  '_ga',
  'ref',
  'ref_src',
  'ref_url',
  'spm',
  'from',
  'share',
  'shareFrom',
];

function isTrackingParam(key: string): boolean {
  for (const pat of TRACKING_PARAM_PATTERNS) {
    if (typeof pat === 'string') {
      if (key.toLowerCase() === pat.toLowerCase()) return true;
    } else if (pat.test(key)) {
      return true;
    }
  }
  return false;
}

/**
 * 仅依赖字符串做归一化：剥离追踪参数 + 去 hash + 去结尾斜杠（保留根路径的 /）。
 * 不依赖 document；解析失败时原样返回。
 */
export function normalizeUrlString(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl ?? '';
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    // 非法 URL，原样返回（由调用方决定是否降级）
    return rawUrl;
  }

  // 1) 剥离追踪参数
  const params = u.searchParams;
  const toDelete: string[] = [];
  params.forEach((_value, key) => {
    if (isTrackingParam(key)) toDelete.push(key);
  });
  for (const k of toDelete) params.delete(k);

  // 2) 去 hash
  u.hash = '';

  // 3) 重组：去结尾斜杠（仅当 path 不是纯 "/"）
  const search = params.toString();
  let pathname = u.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // origin 本身已小写并去掉默认端口
  const qs = search ? `?${search}` : '';
  return `${u.origin}${pathname}${qs}`;
}

/**
 * 从 Document 中读取 canonical URL。
 * 顺序：
 *   1. <link rel="canonical" href="...">
 *   2. <meta property="og:url" content="...">
 *   3. <meta name="twitter:url" content="...">
 * 未命中返回 null。
 *
 * 注：canonical 可能是相对路径，函数会以当前 document URL 为基准解析为绝对地址。
 */
export function readCanonicalFromDocument(doc: Document | null | undefined): string | null {
  if (!doc) return null;

  const tryParse = (raw: string | null, base: string): string | null => {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return new URL(trimmed, base).toString();
    } catch {
      return null;
    }
  };

  const baseUrl = doc.location?.href ?? doc.URL ?? '';

  const canonicalLink = doc.querySelector('link[rel="canonical"]');
  const canonicalHref = tryParse(canonicalLink?.getAttribute('href') ?? null, baseUrl);
  if (canonicalHref) return canonicalHref;

  const ogUrl = doc.querySelector('meta[property="og:url"]');
  const ogHref = tryParse(ogUrl?.getAttribute('content') ?? null, baseUrl);
  if (ogHref) return ogHref;

  const twUrl = doc.querySelector('meta[name="twitter:url"]');
  const twHref = tryParse(twUrl?.getAttribute('content') ?? null, baseUrl);
  if (twHref) return twHref;

  return null;
}

/**
 * 生成最终的 canonical URL（记忆层使用的身份键）。
 *
 * @param doc 当前 Document（content script 或 sidebar 可拿到）；在 background/SW 中传 null
 * @param fallbackUrl 回退 URL（一般是 `location.href` 或传入的 `url`）
 *
 * 流程：
 * 1. 尝试从 doc 读 canonical/og:url/twitter:url
 * 2. 若读到 → 对它做归一化（剥离 UTM / 去 hash / 去结尾斜杠）
 * 3. 否则 → 对 fallbackUrl 做同样归一化
 */
export function canonicalizeUrl(doc: Document | null | undefined, fallbackUrl: string): string {
  const fromDoc = readCanonicalFromDocument(doc);
  const target = fromDoc ?? fallbackUrl ?? '';
  return normalizeUrlString(target);
}

/**
 * 从归一化 URL 提取 domain（如 "react.dev"）
 * 用于 Episodic 按 domain 召回。
 */
export function extractDomain(canonicalUrl: string): string {
  try {
    return new URL(canonicalUrl).hostname;
  } catch {
    return '';
  }
}
