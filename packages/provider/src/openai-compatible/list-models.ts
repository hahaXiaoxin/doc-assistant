/**
 * OpenAI 兼容 /models 列表共享工具
 * ---------------------------------------------
 * (v0.6.0-beta.2 抽离；原逻辑来自 `packages/provider/src/qwen/list-models.ts`)
 *
 *   GET {baseURL}/models
 *   Authorization: Bearer {apiKey}
 *
 * 响应遵循 OpenAI 格式：
 *   { object: 'list', data: [{ id, object: 'model', created?, owned_by? }, ...] }
 *
 * Provider 特有的能力填充（例如 Qwen 的 QWEN_MODEL_CAPABILITIES）由调用方通过
 * `classify` 回调注入。
 */
import { ProviderError, createLogger, maskSecret, compact } from '@doc-assistant/shared';
import { z } from 'zod';
import { joinUrl, safeReadText } from './config';

/** OpenAI 兼容 /models 响应 schema（宽松校验：多余字段忽略） */
const listModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      owned_by: z.string().optional(),
    }),
  ),
});

export interface RawModelEntry {
  id: string;
  ownedBy?: string;
}

export interface ListOpenAICompatibleModelsParams {
  apiKey: string;
  baseURL: string;
  signal?: AbortSignal;
  /** 日志 namespace（默认 `provider:list-models`） */
  logName?: string;
}

/**
 * 拉取 OpenAI 兼容端点的模型列表（去重，未分类）
 *
 * 调用方拿到 `RawModelEntry[]` 后自行做 classify / sort / capability 填充。
 *
 * @throws ProviderError HTTP 非 2xx / 网络错误 / 响应结构非法 / apiKey 或 baseURL 不合法
 */
export async function listOpenAICompatibleModels(
  params: ListOpenAICompatibleModelsParams,
): Promise<RawModelEntry[]> {
  const { apiKey, baseURL, signal } = params;
  const logger = createLogger(params.logName ?? 'provider:list-models');

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
      ...compact({ signal }),
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

  // 去重
  const seen = new Set<string>();
  const items: RawModelEntry[] = [];
  for (const raw of parsed.data.data) {
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    const entry: RawModelEntry = { id: raw.id };
    if (raw.owned_by) entry.ownedBy = raw.owned_by;
    items.push(entry);
  }

  logger.info('拉取模型列表成功（基础）', { count: items.length });

  return items;
}
