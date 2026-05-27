/**
 * Qwen 可用模型列表拉取
 * ---------------------------------------------
 * 仅针对阿里云百炼（DashScope）的 **OpenAI 兼容端点**：
 *   GET {baseURL}/models
 *
 * v0.6.0-beta.2：复用 `listOpenAICompatibleModels` 拉裸列表，再跑千问专属分类规则
 * （classifyQwenModel）+ 填本地能力表 + 排序。
 *
 * 响应遵循 OpenAI 格式，由共享层解析。
 */

import {
  listOpenAICompatibleModels,
  type ListOpenAICompatibleModelsParams,
} from '../openai-compatible/list-models';
import {
  QWEN_MODEL_CAPABILITIES,
  type QwenModelCapability,
} from './config';

/** 按 id 前缀粗分类 —— 只基于约定俗成的命名规律，不保证 100% 准确 */
export type QwenModelKind =
  | 'chat' // qwen-plus / qwen-max / qwen-turbo / qwen3-* / qwq-* ...
  | 'embedding' // text-embedding-*
  | 'rerank' // gte-rerank / text-rerank-* ...
  | 'vision' // qwen-vl-* / qwen2-vl-* ...
  | 'audio' // qwen-audio-* / qwen2-audio-* / paraformer-* ...
  | 'image' // wanx-* / flux-* ...
  | 'other';

/** 一个已分类的模型条目 */
export interface QwenModelListItem {
  id: string;
  kind: QwenModelKind;
  /** OpenAI 响应里的 owned_by */
  ownedBy?: string;
  /** 本地能力表命中时填充（仅 chat 模型） */
  capability?: QwenModelCapability;
}

export type ListQwenModelsParams = ListOpenAICompatibleModelsParams;

/**
 * 拉取 Qwen 账号可用模型列表
 *
 * @throws ProviderError  HTTP 非 2xx / 网络错误 / 响应结构非法 / apiKey 或 baseURL 不合法
 */
export async function listQwenModels(
  params: ListQwenModelsParams,
): Promise<QwenModelListItem[]> {
  const raw = await listOpenAICompatibleModels({
    ...params,
    logName: params.logName ?? 'provider:qwen-list-models',
  });

  const items: QwenModelListItem[] = raw.map((entry) => {
    const kind = classifyQwenModel(entry.id);
    const item: QwenModelListItem = { id: entry.id, kind };
    if (entry.ownedBy) item.ownedBy = entry.ownedBy;
    const cap = QWEN_MODEL_CAPABILITIES[entry.id];
    if (cap && kind === 'chat') item.capability = cap;
    return item;
  });

  items.sort((a, b) => {
    const ra = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (ra !== 0) return ra;
    return a.id.localeCompare(b.id);
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
 *
 * 判定顺序有意义：先剔出更特定的类型，再把剩余都当 chat。
 */
export function classifyQwenModel(id: string): QwenModelKind {
  const n = id.toLowerCase();

  // rerank 先判（优先级最高，避免被 embedding 的 gte-/bge- 前缀抢走）
  if (n.includes('rerank')) return 'rerank';

  // embedding
  if (
    n.startsWith('text-embedding') ||
    n.includes('embedding') ||
    n.startsWith('bge-') ||
    n.startsWith('gte-')
  ) {
    return 'embedding';
  }

  // vision
  if (/\bvl\b/.test(n) || n.startsWith('qvq-') || n === 'qvq') return 'vision';

  // audio
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

  // image / 绘图
  if (
    n.startsWith('wanx') ||
    n.startsWith('flux') ||
    n.startsWith('stable-diffusion') ||
    n.startsWith('sd-') ||
    n.includes('image-generation')
  ) {
    return 'image';
  }

  return 'chat';
}
