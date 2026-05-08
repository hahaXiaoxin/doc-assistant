/**
 * Sidebar 启动装配（v0.5.0 · 统一记忆 / v0.6.0-beta.2 · 凭证分桶重构）
 * ---------------------------------------------
 * 职责：
 * - 读取 STORAGE_KEYS（主/辅 LLMProviderConfig + providerCredentials 桶 + MemorySettings）
 * - 装配主 LLM + 辅助 LLM（sidebar 本地用，不再构造 embedding Provider）
 * - v0.5.0：**记忆层改为 `RemoteMemoryStore`**——sidebar 跑在 content-script
 *   origin，本身不再持 IndexedDB，所有 `memory.xxx()` 通过 RPC 转发到
 *   Offscreen Document 去执行（详见 docs/requirements/v0.5.0-unified-memory.md §1）。
 * - v0.5.0 PR-2：**ReflectionRunner / ReflectionScheduler 完全迁移到 offscreen**——
 *   sidebar 不再构造/启动反思相关对象。PageVisit 结束事件通过
 *   `PAGE_VISIT_ENDED` 消息转发到 offscreen，由 offscreen 内部的 scheduler
 *   登记反思任务并跑 runPending（见 sidebar/index.tsx 的 pvm.subscribe）。
 * - 初始化 PageVisitManager（注入 memory 以登记 page_visits 表，所有 API 走 RPC）
 * - 构造 ChatAgent（组装 Persona/WorkingMemory/RelevantMemory 等 ContextSource）
 *
 * v0.6.0-beta.2：
 * - main/aux LLMProviderConfig 不再含 apiKey/baseURL。凭证从
 *   `providerCredentials[kind]` 读取；桶里没有则回落到 registry 默认 baseURL，
 *   apiKey 用占位符撑住构造，真正调用时报错由用户去 Options 填 Key。
 */
import {
  DEFAULT_AUX_PROVIDER_CONFIG,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_MAIN_PROVIDER_CONFIG,
  DEFAULT_MEMORY_SETTINGS,
  DEFAULT_PROVIDER_CREDENTIALS,
  STORAGE_KEYS,
  clampMaxTurns,
  createLogger,
  createTypedStorage,
  isUseMain,
  type ChatSettings,
  type LLMProviderConfig,
  type MemorySettings,
  type ProviderConfigOrRef,
  type ProviderCredentialsMap,
  type ProviderKind,
  type StorageSchema,
} from '@doc-assistant/shared';
import { PROVIDER_REGISTRY } from '@doc-assistant/provider';
import type { LLMProvider } from '@doc-assistant/provider';
import {
  RemoteMemoryStore,
  type MemoryStore,
} from '@doc-assistant/memory';
import { buildDefaultTools } from '@doc-assistant/tools';
import {
  createChatAgent,
  PageVisitManager,
  recallMemory,
  renderRecallMatches,
  resolveTimeRange,
  type Agent,
} from '@doc-assistant/agent';

const logger = createLogger('extension:sidebar:bootstrap');

export interface BootstrapResult {
  agent: Agent;
  chatSettings: ChatSettings;
  memorySettings: MemorySettings;
  mainProvider: LLMProviderConfig;
  memory: MemoryStore;
  pageVisitManager: PageVisitManager;
  /** v0.2.1：辅助 LLM（供 ChatAgent 后续做 SessionTopic 识别 / recall intent 精判） */
  auxLLM: LLMProvider;
  /** 主 Provider 是否缺失必要配置（apiKey 未填） */
  missingConfig: boolean;
}

/**
 * 从凭证桶取出指定 kind 的 `{ apiKey, baseURL }`。
 * 桶里 apiKey 为空串或 undefined 时 apiKey 返回空；baseURL 落空则回落到 registry 默认值。
 */
function readCredential(
  credentials: ProviderCredentialsMap,
  kind: ProviderKind,
): { apiKey: string; baseURL: string } {
  const slot = credentials[kind];
  const entry = PROVIDER_REGISTRY[kind];
  const defaultBaseURL = entry?.defaultBaseURL ?? '';
  return {
    apiKey: slot?.apiKey?.trim() ? slot.apiKey : '',
    baseURL: slot?.baseURL?.trim() ? slot.baseURL : defaultBaseURL,
  };
}

export async function bootstrapAgent(): Promise<BootstrapResult> {
  const storage = createTypedStorage<StorageSchema>();

  const [mainStored, auxStored, credsStored, chatStored, memStored] = await Promise.all([
    storage.get(STORAGE_KEYS.MAIN_PROVIDER_CONFIG),
    storage.get(STORAGE_KEYS.AUX_PROVIDER_CONFIG),
    storage.get(STORAGE_KEYS.PROVIDER_CREDENTIALS),
    storage.get(STORAGE_KEYS.CHAT_SETTINGS),
    storage.get(STORAGE_KEYS.MEMORY_SETTINGS),
  ]);

  // 主 Provider：MAIN 已配置则用；否则用默认（空凭证），由 OptionsForm 引导用户填写
  const mainProvider: LLMProviderConfig = mainStored
    ? { ...DEFAULT_MAIN_PROVIDER_CONFIG, ...mainStored }
    : DEFAULT_MAIN_PROVIDER_CONFIG;

  const auxConfig: ProviderConfigOrRef<LLMProviderConfig> =
    auxStored ?? DEFAULT_AUX_PROVIDER_CONFIG;

  const credentials: ProviderCredentialsMap = credsStored ?? DEFAULT_PROVIDER_CREDENTIALS;

  const mainCred = readCredential(credentials, mainProvider.kind);

  const chatSettings: ChatSettings = {
    ...DEFAULT_CHAT_SETTINGS,
    ...(chatStored ?? {}),
    maxTurns: clampMaxTurns(chatStored?.maxTurns ?? DEFAULT_CHAT_SETTINGS.maxTurns),
  };
  const memorySettings: MemorySettings = {
    ...DEFAULT_MEMORY_SETTINGS,
    ...(memStored ?? {}),
  };

  const missingConfig = !mainCred.apiKey.trim();
  if (missingConfig) {
    logger.warn('未配置主 Provider API Key，将在首次发送时提示用户配置');
  }

  // 构造主 LLM（通过 registry 反射到对应 Provider 类）
  const mainEntry = PROVIDER_REGISTRY[mainProvider.kind];
  if (!mainEntry) {
    throw new Error(`Unknown provider kind: ${mainProvider.kind}`);
  }
  const mainLLM: LLMProvider = mainEntry.createLLM({
    kind: mainProvider.kind,
    // 缺 Key 时用占位符撑住构造，真正请求时 Provider 会抛错
    apiKey: mainCred.apiKey || 'placeholder',
    baseURL: mainCred.baseURL,
    model: mainProvider.model,
    // 思考模式对外统一为 thinking: boolean，由 Provider 内部翻译到官方 API 形态
    ...(typeof mainProvider.thinking === 'boolean' ? { thinking: mainProvider.thinking } : {}),
  });

  // 构造辅助 LLM（若 useMain 或初始化失败则复用主 LLM）
  let auxLLM: LLMProvider = mainLLM;
  if (!isUseMain(auxConfig)) {
    try {
      const auxEntry = PROVIDER_REGISTRY[auxConfig.kind];
      if (!auxEntry) {
        throw new Error(`Unknown aux provider kind: ${auxConfig.kind}`);
      }
      const auxCred = readCredential(credentials, auxConfig.kind);
      auxLLM = auxEntry.createLLM({
        kind: auxConfig.kind,
        apiKey: auxCred.apiKey || 'placeholder',
        baseURL: auxCred.baseURL,
        model: auxConfig.model,
        ...(typeof auxConfig.thinking === 'boolean' ? { thinking: auxConfig.thinking } : {}),
      });
    } catch (err) {
      logger.warn('辅助 Provider 初始化失败，退回到主 Provider', (err as Error).message);
    }
  }

  // v0.5.0：记忆层改为 RemoteMemoryStore（通过 chrome.runtime.sendMessage 转发到 offscreen）。
  // 不再构造 DexieMemoryStore，也不再传 embedQuery——embedding 由 offscreen 内部持有。
  // v0.5.0 PR-2：不再构造 EmbeddingProvider（embedding 只在 offscreen 需要，供反思 Job 用）。
  const memory: MemoryStore = new RemoteMemoryStore();

  // PageVisitManager（注入 memory 以登记 page_visits）
  const pageVisitManager = new PageVisitManager({ memory });

  // 装配默认 tool 集合（动态按 deps 能力注册 recall / list_recent_visits）
  const tools = buildDefaultTools({
    memory,
    getCurrentVisit: () => pageVisitManager.getCurrent(),
    // recall_memory tool 的执行器：走与 RelevantMemorySource 相同的底层链路（explicit 模式，绕过粗判/精判）
    recallSemantic: async ({
      query,
      timeRange,
      startTs,
      endTs,
      domain,
      articleId,
      limit,
    }) => {
      const outcome = await recallMemory(
        { memory, aux: auxLLM },
        {
          query,
          mode: 'explicit',
          ...(limit !== undefined ? { limit } : {}),
          ...(timeRange !== undefined ? { timeRange } : {}),
          ...(startTs !== undefined ? { startTs } : {}),
          ...(endTs !== undefined ? { endTs } : {}),
          ...(domain !== undefined ? { domain } : {}),
          ...(articleId !== undefined ? { articleId } : {}),
        },
      );
      return {
        hit: outcome.hit,
        count: outcome.matches.length,
        text: outcome.hit ? renderRecallMatches(outcome.matches) : '',
      };
    },
    // list_recent_visits tool 的执行器：走 memory.recall 取 visit_summary 清单，不走向量
    listRecentVisits: async ({ timeRange, startTs, endTs, domain, limit }) => {
      const { startTs: s, endTs: e } = resolveTimeRange(timeRange, {
        ...(startTs !== undefined ? { startTs } : {}),
        ...(endTs !== undefined ? { endTs } : {}),
      });
      const visits = await memory.recall({
        types: ['visit_summary'],
        timeRange: [s, e],
        ...(domain !== undefined ? { domain } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      const items = visits.map((v) => ({
        visitId: v.visitId ?? v.id,
        url: v.url ?? v.canonicalUrl ?? '',
        ...(v.meta && typeof (v.meta as { title?: unknown }).title === 'string'
          ? { title: (v.meta as { title?: string }).title! }
          : {}),
        ...(v.domain !== undefined ? { domain: v.domain } : {}),
        summary: v.content ?? '',
        tags: v.topic ?? [],
        timestamp: v.timestamp,
      }));
      return { count: items.length, visits: items };
    },
  });

  // 装配 Agent（auxLLM 存在时 RelevantMemorySource 启用 aux-intent 精判）
  const agent = createChatAgent({
    llm: mainLLM,
    memory,
    tools,
    systemPrompt: chatSettings.systemPrompt,
    maxHistoryChars: chatSettings.maxContextChars,
    maxTurns: chatSettings.maxTurns,
    auxLLM,
  });

  // v0.5.0 PR-2：反思 Job（ReflectionRunner / ReflectionScheduler）已完全迁移到 offscreen。
  // sidebar 只负责通过 PAGE_VISIT_ENDED 消息把 visit 结束事件转发给 offscreen（见 sidebar/index.tsx）。

  logger.info('Sidebar bootstrap 完成', {
    mainKind: mainProvider.kind,
    mainModel: mainProvider.model,
    auxUseMain: isUseMain(auxConfig),
    memoryKind: 'remote',
    reflectionLocation: 'offscreen', // v0.5.0 PR-2
    tools: tools.map((t) => t.name),
    maxTurns: chatSettings.maxTurns,
    missingConfig,
  });

  return {
    agent,
    chatSettings,
    memorySettings,
    mainProvider,
    memory,
    pageVisitManager,
    auxLLM,
    missingConfig,
  };
}
