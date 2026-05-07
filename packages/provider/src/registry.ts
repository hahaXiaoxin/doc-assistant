/**
 * Provider Registry · kind → Provider class + 元数据 声明式映射
 * ---------------------------------------------
 * v0.6.0-beta.2 新增。目标是消除装配层 / UI 层对 `kind === 'qwen' ? ...` 的硬编码判断。
 *
 * 用法：
 * - 装配层（sidebar/bootstrap / offscreen/index）：`PROVIDER_REGISTRY[kind].createLLM(config)`
 * - UI 下拉：`Object.values(PROVIDER_REGISTRY).map(e => ({ value: e.kind, label: e.displayName }))`
 * - Embedding 下拉（UI）：过滤 `entry.embedding !== null`，DeepSeek 自动被剔除
 *
 * 增加一家新 OpenAI 兼容 Provider 的变更点：
 * 1. 新增 `packages/provider/src/xxx/{index,config,list-models}.ts`
 * 2. 在 `ProviderKind` 联合里加一项
 * 3. 在本文件 PROVIDER_REGISTRY 里加一行
 * 4. 如需专属 UI 默认值，在 shared/config.ts 加一个 DEFAULT_XXX_PROVIDER_CONFIG
 *
 * 其他位置（装配 / 下拉 / zod 校验）无需改动。
 */
import {
  DEFAULT_DEEPSEEK_PROVIDER_CONFIG,
  DEFAULT_MAIN_PROVIDER_CONFIG,
  type LLMProviderConfig,
  type ProviderKind,
} from '@doc-assistant/shared';
import type { LLMProvider } from './interface';
import type { EmbeddingProvider } from './embedding-interface';
import { QwenProvider } from './qwen/index';
import { QwenEmbeddingProvider } from './qwen/embedding';
import { listQwenModels } from './qwen/list-models';
import { DeepSeekProvider } from './deepseek/index';
import { listDeepSeekModels } from './deepseek/list-models';
import { DEEPSEEK_MODELS } from './deepseek/config';

/** 通用模型分类（UI 根据此决定下拉中如何展示） */
export type GenericModelKind =
  | 'chat'
  | 'embedding'
  | 'rerank'
  | 'vision'
  | 'audio'
  | 'image'
  | 'other';

/** UI 层看到的统一模型条目 */
export interface GenericModelListItem {
  id: string;
  kind: GenericModelKind;
  ownedBy?: string;
  /** 本地能力命中时填充（仅 chat） */
  capability?: {
    contextWindow: number;
    supportsReasoning: boolean;
    supportsTools: boolean;
  };
}

/** Registry 中 list-models 函数的统一签名 */
export type ListModelsFn = (params: {
  apiKey: string;
  baseURL: string;
  signal?: AbortSignal;
}) => Promise<GenericModelListItem[]>;

/** Registry 中 LLM 工厂的统一签名 */
export type LLMProviderFactory = (config: LLMProviderConfig) => LLMProvider;

/** Provider 的 embedding 能力元信息（null 表示"不提供 embedding"） */
export interface EmbeddingRegistryInfo {
  /** 供 EmbeddingProviderConfig.kind 引用；本期只有 'qwen-embedding' */
  kind: string;
  createEmbedding: (config: {
    apiKey: string;
    baseURL: string;
    model: string;
    dimension: number;
  }) => EmbeddingProvider;
}

export interface ProviderRegistryEntry {
  /** 与 ProviderKind 一致 */
  kind: ProviderKind;
  /** UI 下拉展示名 */
  displayName: string;
  /** 简短描述，UI 可选用作 tooltip */
  description?: string;
  /** UI 切换 Provider 时的默认配置（baseURL / model / 推荐 thinking 开关等） */
  defaultConfig: LLMProviderConfig;
  /** 主 / 辅 LLM 工厂 */
  createLLM: LLMProviderFactory;
  /** 拉取 /models 列表（已做 kind 分类 + capability 填充） */
  listModels: ListModelsFn;
  /** UI fallback 建议模型列表（拉取失败或未拉取时使用） */
  suggestedModels: readonly string[];
  /** embedding 能力：null = 本家未提供；非 null 可被"主路径 embedding useMain=true" 使用 */
  embedding: EmbeddingRegistryInfo | null;
  /**
   * 推荐组合（仅产品信息，不影响运行时）
   * 例如 DeepSeek 推荐 `main+aux=DeepSeek, embedding=Qwen v3`
   */
  recommendedCombo?: {
    /** 当用户选择本 Provider 作为主 Provider 时推荐的 embedding kind */
    embeddingKind: string;
    /** 人类可读说明 */
    hint: string;
  };
}

export const PROVIDER_REGISTRY: Record<ProviderKind, ProviderRegistryEntry> = {
  qwen: {
    kind: 'qwen',
    displayName: '千问 Qwen（阿里云百炼）',
    description:
      '阿里云百炼 OpenAI 兼容端点，支持 chat / tool call / reasoning（qwen3 系列）/ embedding / rerank 等多能力。',
    defaultConfig: DEFAULT_MAIN_PROVIDER_CONFIG,
    createLLM: (config) =>
      new QwenProvider({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        model: config.model,
        enableThinking: config.enableThinking ?? true,
      }),
    listModels: async (params) => {
      const items = await listQwenModels(params);
      return items.map((m) => ({
        id: m.id,
        kind: m.kind as GenericModelKind,
        ...(m.ownedBy !== undefined ? { ownedBy: m.ownedBy } : {}),
        ...(m.capability ? { capability: m.capability } : {}),
      }));
    },
    suggestedModels: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen3-max'],
    embedding: {
      kind: 'qwen-embedding',
      createEmbedding: (config) => new QwenEmbeddingProvider(config),
    },
  },
  deepseek: {
    kind: 'deepseek',
    displayName: 'DeepSeek',
    description:
      'DeepSeek 官方端点，支持 deepseek-chat（V3 非思考）/ deepseek-reasoner（R1 思考，走 reasoning-delta）。官方暂无 embedding 服务。',
    defaultConfig: DEFAULT_DEEPSEEK_PROVIDER_CONFIG,
    createLLM: (config) =>
      new DeepSeekProvider({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        model: config.model,
        ...(typeof config.enableThinking === 'boolean'
          ? { enableThinking: config.enableThinking }
          : {}),
      }),
    listModels: async (params) => {
      const items = await listDeepSeekModels(params);
      return items.map((m) => ({
        id: m.id,
        kind: (m.kind === 'chat' ? 'chat' : 'other') as GenericModelKind,
        ...(m.ownedBy !== undefined ? { ownedBy: m.ownedBy } : {}),
        ...(m.capability ? { capability: m.capability } : {}),
      }));
    },
    suggestedModels: DEEPSEEK_MODELS,
    embedding: null,
    recommendedCombo: {
      embeddingKind: 'qwen-embedding',
      hint: '推荐 DeepSeek 主对话 + Qwen text-embedding-v3 向量模型组合。',
    },
  },
};

/** 取 registry 某条；如果 kind 未知则 throw 让调用方尽早发现配置脏数据 */
export function getProviderEntry(kind: ProviderKind): ProviderRegistryEntry {
  const entry = PROVIDER_REGISTRY[kind];
  if (!entry) {
    throw new Error(`Unknown provider kind: ${kind}`);
  }
  return entry;
}

/** 列出所有 registry 条目（UI 下拉用） */
export function listProviderEntries(): ProviderRegistryEntry[] {
  return Object.values(PROVIDER_REGISTRY);
}

/** 列出提供 embedding 能力的 Provider；用于 embedding 下拉过滤 */
export function listEmbeddingCapableProviders(): ProviderRegistryEntry[] {
  return listProviderEntries().filter((e) => e.embedding !== null);
}
