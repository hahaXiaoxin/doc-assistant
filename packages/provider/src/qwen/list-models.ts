/**
 * Qwen 可用模型列表拉取
 * ---------------------------------------------
 * 仅针对阿里云百炼（DashScope）的 **OpenAI 兼容端点**：
 *   GET {baseURL}/models
 *   Authorization: Bearer {apiKey}
 *
 * 响应遵循 OpenAI 格式：
 *   { object: 'list', data: [{ id, object: 'model', created, owned_by }, ...] }
 *
 * 注意：
 * - DashScope 原生端点（/api/v1）**没有**列出模型的接口；调用方需使用 /compatible-mode/v1。
 * - 响应只含模型 id，不含 contextWindow / supportsTools 等能力；能力来自本地 QWEN_MODEL_CAPABILITIES 表兜底。
 * - 返回列表会混杂 chat / embedding / rerank / vision / audio 多种模型；本文件提供 classifyQwenModel()
 *   按 id 前缀分类，UI 可据此过滤。
 * - 本函数**不做任何缓存**；调用方（UI）决定是否缓存以及何时刷新。
 */

import { ProviderError, createLogger, maskSecret } from '@doc-assistant/shared';
import { z } from 'zod';
import {
  QWEN_MODEL_CAPABILITIES,
  type QwenModelCapability,
} from './config';

const logger = createLogger('provider:qwen-list-models');

/** 按 id 前缀粗分类 —— 只基于约定俗成的命名规律，不保证 100% 准确 */
export type QwenModelKind =
  | 'chat' // qwen-plus / qwen-max / qwen-turbo / qwen3-* / qwq-* ...
  | 'embedding' // text-embedding-*
  | 'rerank' // gte-rerank / text-rerank-* ...
  | 'vision' // qwen-vl-* / qwen2-vl-* ...
  | 'audio' // qwen-audio-* / qwen2-audio-* / paraformer-* ...
  | 'image' // wanx-* / flux-* ...
  | 'other';

/**
 * 一个已分类的模型条目
 * ---------------------------------------------
 * `capability` 仅对 chat 类模型有意义，且仅在本地 QWEN_MODEL_CAPABILITIES 命中时填充。
 * 调用方看到 capability=undefined 不代表模型不可用，只是"未知能力"。
 */
export interface QwenModelListItem {
  id: string;
  kind: QwenModelKind;
  /** OpenAI 响应里的 owned_by，通常是 'system' / 'openai' / 自定义 —— 直接透传，UI 可展示 */
  ownedBy?: string;
  /** 本地能力表命中时填充（仅 chat 模型） */
  capability?: QwenModelCapability;
}

/** OpenAI 兼容 /models 响应 schema（宽松校验：多余字段忽略） */
const listModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      owned_by: z.string().optional(),
    }),
  ),
});

export interface ListQwenModelsParams {
  apiKey: string;
  baseURL: string;
  signal?: AbortSignal;
}

/**
 * 拉取 Qwen 账号可用模型列表
 * ---------------------------------------------
 * @throws ProviderError  HTTP 非 2xx / 网络错误 / 响应结构非法 / apiKey 或 baseURL 不合法
 */
export async function listQwenModels(
  params: ListQwenModelsParams,
): Promise<QwenModelListItem[]> {
  const { apiKey, baseURL, signal } = params;

  if (!apiKey?.trim()) {
    throw new ProviderError('INVALID_CONFIG', 'apiKey 不能为空');
  }
  if (!baseURL?.trim()) {
    throw new ProviderError('INVALID_CONFIG', 'baseURL 不能为空');
  }

  const url = joinUrl(baseURL, '/models');
  logger.info('拉取模型列表', { baseURL, apiKey: maskSecret(apiKey) });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ProviderError('ABORTED', '用户中断模型列表请求', { cause: err });
    }
    throw new ProviderError(
      'NETWORK_ERROR',
      `拉取模型列表失败：${(err as Error).message}`,
      { cause: err },
    );
  }

  if (!response.ok) {
    const body = await safeReadText(response);
    throw new ProviderError(
      'LIST_MODELS_HTTP_ERROR',
      `拉取模型列表返回 ${response.status}：${body.slice(0, 200)}`,
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    throw new ProviderError(
      'LIST_MODELS_PARSE_ERROR',
      `模型列表响应非合法 JSON：${(err as Error).message}`,
      { cause: err },
    );
  }

  const parsed = listModelsResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderError(
      'LIST_MODELS_SCHEMA_ERROR',
      `模型列表响应结构非法：${parsed.error.message}`,
    );
  }

  // 按 id 去重 + 稳定排序（chat → embedding → rerank → vision → audio → image → other；组内按 id 字典序）
  const seen = new Set<string>();
  const items: QwenModelListItem[] = [];
  for (const raw of parsed.data.data) {
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    const kind = classifyQwenModel(raw.id);
    const item: QwenModelListItem = { id: raw.id, kind };
    if (raw.owned_by) item.ownedBy = raw.owned_by;
    const cap = QWEN_MODEL_CAPABILITIES[raw.id];
    if (cap && kind === 'chat') item.capability = cap;
    items.push(item);
  }

  items.sort((a, b) => {
    const ra = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (ra !== 0) return ra;
    return a.id.localeCompare(b.id);
  });

  logger.info('拉取模型列表成功', {
    count: items.length,
    byKind: summarizeByKind(items),
  });

  return items;
}

const KIND_ORDER: Record<QwenModelKind, number> = {
  chat: 0,
  embedding: 1,
  rerank: 2,
  vision: 3,
  audio: 4,
  image: 5,
  other: 6,
};

/**
 * 按 id 前缀分类
 * ---------------------------------------------
 * 设计原则：**默认归类 chat，只把能明确识别的非 chat 类型剔出去**。
 * 原因：DashScope 返回的模型 id 五花八门（qwen / qwen3 / qwen-long / qwen-coder /
 * qwen-math / qwen-omni / farui / baichuan / chatglm / internlm / deepseek / llama /
 * moonshot / yi / 自定义微调 ...），白名单无法穷举。只要不是明确的 embedding / rerank /
 * vision / audio / image，就当作 chat 给用户选择。
 *
 * 判定顺序有意义：先剔出更特定的类型，再把剩余都当 chat。
 */
export function classifyQwenModel(id: string): QwenModelKind {
  const n = id.toLowerCase();

  // rerank 先判（优先级最高，避免被 embedding 的 gte-/bge- 前缀抢走）
  if (n.includes('rerank')) return 'rerank';

  // embedding：text-embedding-* / *embedding* / bge-* / gte-* 向量模型族
  if (
    n.startsWith('text-embedding') ||
    n.includes('embedding') ||
    n.startsWith('bge-') ||
    n.startsWith('gte-')
  ) {
    return 'embedding';
  }

  // vision：qwen-vl-* / qwen2-vl-* / qwen2.5-vl-* / qvq-* / *-vl-*
  // 之前写 [\b]（字符类里 \b 是退格符）是 bug，这里用 \b 单词边界
  if (/\bvl\b/.test(n) || n.startsWith('qvq-') || n === 'qvq') return 'vision';

  // audio：含 audio / paraformer / sensevoice / cosyvoice / sambert / tts / asr
  if (
    n.includes('audio') ||
    n.startsWith('paraformer') ||
    n.startsWith('sensevoice') ||
    n.startsWith('cosyvoice') ||
    n.startsWith('sambert') ||
    /\btts\b/.test(n) ||
    /\basr\b/.test(n)
  ) {
    return 'audio';
  }

  // image / 绘图：wanx-* / flux-* / stable-diffusion-* / sd-* / *image-generation*
  if (
    n.startsWith('wanx') ||
    n.startsWith('flux') ||
    n.startsWith('stable-diffusion') ||
    n.startsWith('sd-') ||
    n.includes('image-generation')
  ) {
    return 'image';
  }

  // 其余一律视作 chat（包括自定义微调 / 未知厂商 / 未来新模型 / farui / baichuan / chatglm ...）
  return 'chat';
}

function summarizeByKind(items: QwenModelListItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) out[it.kind] = (out[it.kind] ?? 0) + 1;
  return out;
}

function joinUrl(baseURL: string, path: string): string {
  const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

async function safeReadText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}
