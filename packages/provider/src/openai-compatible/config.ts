/**
 * OpenAI 兼容 Provider 的共享 utilities / schema
 * ---------------------------------------------
 * 所有 OpenAI 兼容端点（Qwen / DeepSeek / 未来 OpenAI / Moonshot 等）共享的基础字段：
 * apiKey + baseURL + model。
 *
 * Provider 特有的字段（如 Qwen 的 `enableThinking` / DeepSeek 的 `enableThinking`）
 * 由各子 Provider 的 config.ts 在 `openAICompatibleBaseConfigSchema` 之上扩展。
 */
import { z } from 'zod';

/** 基础字段：apiKey / baseURL / model */
export const openAICompatibleBaseConfigSchema = z.object({
  apiKey: z.string().trim().min(1, 'apiKey 不能为空'),
  baseURL: z.string().trim().url('baseURL 必须是合法 URL'),
  model: z.string().trim().min(1, 'model 不能为空'),
});

export type OpenAICompatibleBaseConfig = z.infer<typeof openAICompatibleBaseConfigSchema>;

/** 把 baseURL 与 path 稳健拼接，自动处理结尾斜杠 */
export function joinUrl(baseURL: string, path: string): string {
  const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/** 安全读取 Response body 为文本，失败时返回空串 */
export async function safeReadText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}

/** 兜底 JSON 解析：失败则原样返回 */
export function safeParseJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
