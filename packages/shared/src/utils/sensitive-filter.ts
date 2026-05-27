/**
 * 敏感信息过滤工具
 * ---------------------------------------------
 * v0.2 · 在记忆层写入 IndexedDB 之前替换敏感字符串为占位符
 *
 * 设计原则（见 docs/ROADMAP.md §2 "敏感信息过滤"）：
 * - **默认开启**（用户可在配置页关闭）
 * - 过滤发生在记忆写入前：原文不落 IDB，LLM 召回时看到的也是占位符
 * - 占位符格式：`[REDACTED:type]`，便于审计页展示、排查问题
 * - 纯函数，无副作用；正则规则可扩展但必须保守（宁可漏过真实敏感，不可误伤正文）
 *
 * 覆盖类型：
 * - `email`：常规 email
 * - `phone`：中国大陆 11 位手机号
 * - `idcard`：中国大陆 18 位身份证
 * - `apikey`：常见 API Key 前缀（sk- / AKID / pk- / ghp_ / gho_ / JWT 三段）
 * - `creditcard`：13~19 位连续数字段（含空格/连字符分隔，Luhn 近似）
 */

export type RedactType = 'email' | 'phone' | 'idcard' | 'apikey' | 'creditcard';

export interface RedactResult {
  /** 替换后的文本（若 `enabled=false` 则等于输入） */
  text: string;
  /** 是否至少命中一条规则（用于日志/统计） */
  redacted: boolean;
  /** 各类型命中次数（便于审计） */
  counts: Record<RedactType, number>;
}

interface RedactRule {
  type: RedactType;
  pattern: RegExp;
}

/**
 * 敏感规则集
 * - 手机号采用"前后非数字边界"避免误伤长数字串
 * - 身份证采用 18 位严格格式（结尾 X 可选）
 * - API Key 放宽为常见前缀 + 紧随的字母数字/连字符
 * - 信用卡采用 13-19 位数字（可含空格/连字符）+ 前后非数字边界
 *
 * 顺序：先匹配最具识别性的（email / idcard / apikey），最后是手机号和信用卡（避免被长数字吃掉）
 */
const RULES: RedactRule[] = [
  // email 不包含空格，常规 RFC 近似
  { type: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // JWT：三段 base64url 由 "." 分隔（最短各 8 个字符避免误伤）
  { type: 'apikey', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // OpenAI / Anthropic / GitHub / 腾讯云 等常见前缀
  { type: 'apikey', pattern: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g },
  { type: 'apikey', pattern: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { type: 'apikey', pattern: /\bgho_[A-Za-z0-9]{20,}\b/g },
  { type: 'apikey', pattern: /\bAKID[A-Za-z0-9]{16,}\b/g },
  { type: 'apikey', pattern: /\bAKIA[A-Z0-9]{16}\b/g },
  // 中国大陆身份证（18 位，末尾可 X）
  { type: 'idcard', pattern: /(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])/g },
  // 信用卡：13~19 位数字，允许空格/连字符分隔（前后非数字边界）
  {
    type: 'creditcard',
    pattern: /(?<![0-9])(?:\d[ -]?){12,18}\d(?![0-9])/g,
  },
  // 中国大陆手机号：1[3-9]\d{9}（前后非数字边界）
  { type: 'phone', pattern: /(?<![0-9])1[3-9]\d{9}(?![0-9])/g },
];

/**
 * 过滤文本中的敏感信息。
 * @param text 原文
 * @param enabled 是否启用（配置页开关；默认 true）
 */
export function redactSensitive(text: string, enabled = true): RedactResult {
  const counts: Record<RedactType, number> = {
    email: 0,
    phone: 0,
    idcard: 0,
    apikey: 0,
    creditcard: 0,
  };
  if (!enabled || !text) {
    return { text: text ?? '', redacted: false, counts };
  }

  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, () => {
      counts[rule.type] += 1;
      return `[REDACTED:${rule.type}]`;
    });
  }

  const redacted = Object.values(counts).some((n) => n > 0);
  return { text: out, redacted, counts };
}

/**
 * 仅返回 text（简化调用），不关心 counts。
 * 用于不需要审计统计的热路径。
 */
export function redactSensitiveText(text: string, enabled = true): string {
  return redactSensitive(text, enabled).text;
}
