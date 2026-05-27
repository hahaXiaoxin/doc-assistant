/**
 * DeepSeek 可用模型列表拉取
 * ---------------------------------------------
 * v0.6.0-beta.2 新增。DeepSeek 官方 `GET https://api.deepseek.com/models` 返回 OpenAI 格式：
 *
 *   { "object": "list", "data": [ { "id": "string", "object": "model", "owned_by": "string" }, ... ] }
 *
 * 响应体**没有** category/capability 字段——`id` 就是模型名。
 * DeepSeek 官方目前只有两款 chat 模型（`deepseek-v4-flash` / `deepseek-v4-pro`），
 * 无 embedding / rerank；因此分类函数固定返回 `chat`，capability 由本地能力表兜底填充。
 */

import {
  listOpenAICompatibleModels,
  type ListOpenAICompatibleModelsParams,
} from '../openai-compatible/list-models';
import {
  DEEPSEEK_MODEL_CAPABILITIES,
  type DeepSeekModelCapability,
} from './config';

/** DeepSeek 目前只有 chat，但保留联合为扩展做准备 */
export type DeepSeekModelKind = 'chat' | 'other';

export interface DeepSeekModelListItem {
  id: string;
  kind: DeepSeekModelKind;
  ownedBy?: string;
  capability?: DeepSeekModelCapability;
}

export type ListDeepSeekModelsParams = ListOpenAICompatibleModelsParams;

/**
 * 拉取 DeepSeek 账号可用模型列表
 *
 * @throws ProviderError  HTTP 非 2xx / 网络错误 / 响应结构非法
 */
export async function listDeepSeekModels(
  params: ListDeepSeekModelsParams,
): Promise<DeepSeekModelListItem[]> {
  const raw = await listOpenAICompatibleModels({
    ...params,
    logName: params.logName ?? 'provider:deepseek-list-models',
  });

  const items: DeepSeekModelListItem[] = raw.map((entry) => {
    const kind = classifyDeepSeekModel(entry.id);
    const item: DeepSeekModelListItem = { id: entry.id, kind };
    if (entry.ownedBy) item.ownedBy = entry.ownedBy;
    const cap = DEEPSEEK_MODEL_CAPABILITIES[entry.id];
    if (cap && kind === 'chat') item.capability = cap;
    return item;
  });

  // 字典序
  items.sort((a, b) => a.id.localeCompare(b.id));
  return items;
}

/**
 * DeepSeek 模型分类
 *
 * 官方 `/models` 响应没有 category 字段；DeepSeek 目前全部是 chat 类模型
 * （`deepseek-v4-flash` / `deepseek-v4-pro`），无 embedding / rerank；统一归类为 `chat`。
 * 保留 `other` 以防未来官方上线新种类。
 */
export function classifyDeepSeekModel(_id: string): DeepSeekModelKind {
  return 'chat';
}
