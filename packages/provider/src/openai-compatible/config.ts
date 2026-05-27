/**
 * OpenAI 兼容 Provider 的共享 utilities / schema
 * ---------------------------------------------
 * 所有 OpenAI 兼容端点（Qwen / DeepSeek / 未来 OpenAI / Moonshot 等）共享的基础字段：
 * apiKey + baseURL + model + thinking（思考模式开关）。
 *
 * 思考模式对外统一为 `thinking: boolean`，各 Provider 子类在 `getProviderOptions()`
 * 里翻译为官方 API 要求的形态（Provider 作为兼容层承担参数翻译）。各子 Provider 如需
 * 强制默认值（如 DeepSeek 默认启用），可在其自己的 config.ts 里 extend 时 `.default(...)`。
 */
import { z } from 'zod';

/** 基础字段：apiKey / baseURL / model / thinking */
export const openAICompatibleBaseConfigSchema = z.object({
  apiKey: z.string().trim().min(1, 'apiKey 不能为空'),
  baseURL: z.string().trim().url('baseURL 必须是合法 URL'),
  model: z.string().trim().min(1, 'model 不能为空'),
  thinking: z.boolean().optional(),
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
