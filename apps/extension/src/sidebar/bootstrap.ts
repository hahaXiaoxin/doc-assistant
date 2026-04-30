/**
 * Sidebar 启动装配（v0.5.0 · 统一记忆）
 * ---------------------------------------------
 * 职责：
 * - 读取 STORAGE_KEYS（主/辅/embedding 三套 + MemorySettings）
 * - 装配三套 Provider（辅助/embedding 按 useMain 回退到主 Provider 配置）
 * - v0.5.0：**记忆层改为 `RemoteMemoryStore`**——sidebar 跑在 content-script
 *   origin，本身不再持 IndexedDB，所有 `memory.xxx()` 通过 RPC 转发到
 *   Offscreen Document 去执行（详见 docs/requirements/v0.5.0-unified-memory.md §1）。
 *   原本的 DexieMemoryStore 构造 + embedQuery 闭包已迁移至 offscreen。
 * - 初始化 PageVisitManager（注入 memory 以登记 page_visits 表，所有 API 走 RPC）
 * - 构造 ChatAgent（phase2=true 接入新 ContextSource）
 * - 返回给 SidebarApp 使用
 *
 * 注意：PR-1 阶段 ReflectionRunner / ReflectionScheduler 依然在 sidebar 运行
 *       （走 RemoteStore 读写 DB），PR-2 会整体迁移到 offscreen。
 */
import {
  DEFAULT_AUX_PROVIDER_CONFIG,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_EMBEDDING_PROVIDER_CONFIG,
  DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK,
  DEFAULT_MAIN_PROVIDER_CONFIG,
  DEFAULT_MEMORY_SETTINGS,
  STORAGE_KEYS,
  clampMaxTurns,
  createLogger,
  createTypedStorage,
  isUseMain,
  type ChatSettings,
  type EmbeddingProviderConfig,
  type LLMProviderConfig,
  type MemorySettings,
  type ProviderConfigOrRef,
  type StorageSchema,
} from '@doc-assistant/shared';
import { QwenProvider, QwenEmbeddingProvider } from '@doc-assistant/provider';
import type { EmbeddingProvider, LLMProvider } from '@doc-assistant/provider';
import {
  RemoteMemoryStore,
  type MemoryStore,
} from '@doc-assistant/memory';
import { buildPhase2Tools } from '@doc-assistant/tools';
import {
  createChatAgent,
  PageVisitManager,
  ReflectionRunner,
  ReflectionScheduler,
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
  /** v0.2.1：反思任务调度器（sidebar 启动后调用 runPending，并订阅 PageVisit 结束） */
  reflectionScheduler: ReflectionScheduler | null;
  /** v0.2.1：辅助 LLM（供 ChatAgent 后续做 SessionTopic 识别 / recall intent 精判） */
  auxLLM: LLMProvider;
  /** v0.2.1：Embedding Provider（可能为 null，召回将降级到关键词） */
  embeddingProvider: EmbeddingProvider | null;
  /** 主 Provider 是否缺失必要配置（apiKey 未填） */
  missingConfig: boolean;
}

export async function bootstrapAgent(): Promise<BootstrapResult> {
  const storage = createTypedStorage<StorageSchema>();

  const [
    mainStored,
    auxStored,
    embStored,
    chatStored,
    memStored,
  ] = await Promise.all([
    storage.get(STORAGE_KEYS.MAIN_PROVIDER_CONFIG),
    storage.get(STORAGE_KEYS.AUX_PROVIDER_CONFIG),
    storage.get(STORAGE_KEYS.EMBEDDING_PROVIDER_CONFIG),
    storage.get(STORAGE_KEYS.CHAT_SETTINGS),
    storage.get(STORAGE_KEYS.MEMORY_SETTINGS),
  ]);

  // 主 Provider：MAIN 已配置则用；否则用默认（空 apiKey），由 OptionsForm 引导用户填写
  let mainProvider: LLMProviderConfig = mainStored
    ? { ...DEFAULT_MAIN_PROVIDER_CONFIG, ...mainStored }
    : DEFAULT_MAIN_PROVIDER_CONFIG;

  const auxConfig: ProviderConfigOrRef<LLMProviderConfig> =
    auxStored ?? DEFAULT_AUX_PROVIDER_CONFIG;
  const embConfig: ProviderConfigOrRef<EmbeddingProviderConfig> =
    embStored ?? DEFAULT_EMBEDDING_PROVIDER_CONFIG;

  const chatSettings: ChatSettings = {
    ...DEFAULT_CHAT_SETTINGS,
    ...(chatStored ?? {}),
    maxTurns: clampMaxTurns(chatStored?.maxTurns ?? DEFAULT_CHAT_SETTINGS.maxTurns),
  };
  const memorySettings: MemorySettings = {
    ...DEFAULT_MEMORY_SETTINGS,
    ...(memStored ?? {}),
  };

  const missingConfig = !mainProvider.apiKey.trim();
  if (missingConfig) {
    logger.warn('未配置主 Provider API Key，将在首次发送时提示用户配置');
    // 用 placeholder 占位，避免 Agent 构造失败；真正调用时会抛错
    mainProvider = { ...mainProvider, apiKey: 'placeholder' };
  }

  // 构造主 LLM
  const mainLLM: LLMProvider = new QwenProvider({
    apiKey: mainProvider.apiKey,
    baseURL: mainProvider.baseURL,
    model: mainProvider.model,
    enableThinking: mainProvider.enableThinking ?? true,
  });

  // 构造辅助 LLM（若 useMain 或为空则直接复用主 LLM）
  let auxLLM: LLMProvider = mainLLM;
  if (!isUseMain(auxConfig)) {
    try {
      auxLLM = new QwenProvider({
        apiKey: auxConfig.apiKey,
        baseURL: auxConfig.baseURL,
        model: auxConfig.model,
        enableThinking: auxConfig.enableThinking ?? false,
      });
    } catch (err) {
      logger.warn('辅助 Provider 初始化失败，退回到主 Provider', (err as Error).message);
    }
  }

  // 构造 Embedding Provider（若 useMain 则用主 Provider 的 baseURL+apiKey + 默认 embedding 模型）
  let embeddingProvider: EmbeddingProvider | null = null;
  try {
    if (isUseMain(embConfig)) {
      embeddingProvider = new QwenEmbeddingProvider({
        apiKey: mainProvider.apiKey,
        baseURL: mainProvider.baseURL,
        model: DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK.model,
        dimension: DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK.dimension,
      });
    } else {
      embeddingProvider = new QwenEmbeddingProvider({
        apiKey: embConfig.apiKey,
        baseURL: embConfig.baseURL,
        model: embConfig.model,
        dimension: embConfig.dimension,
      });
    }
  } catch (err) {
    logger.warn(
      'Embedding Provider 初始化失败（不阻塞启动；召回将降级到关键词）',
      (err as Error).message,
    );
  }

  // v0.5.0：记忆层改为 RemoteMemoryStore（通过 chrome.runtime.sendMessage 转发到 offscreen）。
  // 不再构造 DexieMemoryStore，也不再传 embedQuery——embedding 由 offscreen 内部持有。
  const memory: MemoryStore = new RemoteMemoryStore();

  // PageVisitManager（注入 memory 以登记 page_visits）
  const pageVisitManager = new PageVisitManager({ memory });

  // v0.2.1 → v0.4.0：装配 Phase2 tool 集合
  // MVP 3 + WorkingMemory 7 + remember_persona + recall_memory（语义召回）+ list_recent_visits（时间维）
  const tools = buildPhase2Tools({
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
    // （title 的 URL 兜底在 tool 定义层做，此处保持透传语义）
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
      // memory.recall 无 semantic 时已按 timestamp 倒序
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

  // 装配 Agent（phase2=true + auxLLM → 自动启用 Phase2-1，含 RelevantMemorySource）
  const agent = createChatAgent({
    llm: mainLLM,
    memory,
    tools,
    systemPrompt: chatSettings.systemPrompt,
    maxHistoryChars: chatSettings.maxContextChars,
    maxTurns: chatSettings.maxTurns,
    phase2: true,
    auxLLM,
  });

  // v0.2.1：反思调度器
  // - 仅在 memorySettings.reflectionEnabled 时挂；
  // - 失败不阻塞启动（scheduler=null 意味着 PageVisit 结束后不登记任务）。
  let reflectionScheduler: ReflectionScheduler | null = null;
  if (memorySettings.reflectionEnabled) {
    try {
      const runner = new ReflectionRunner({
        memory,
        aux: auxLLM,
        embedding: embeddingProvider,
      });
      reflectionScheduler = new ReflectionScheduler({ memory, runner });
      // 订阅 PageVisit 结束 → 自动登记 3 条反思任务并尝试立即跑
      reflectionScheduler.registerOnPageVisitEnd(pageVisitManager);
      // 启动时补跑一次历史 pending 任务（fire-and-forget）
      void reflectionScheduler.runPending().catch((err: Error) => {
        logger.warn('ReflectionScheduler.runPending 启动补跑失败', err.message);
      });
    } catch (err) {
      logger.warn(
        'ReflectionScheduler 构建失败（不阻塞启动；反思任务将不会被处理）',
        (err as Error).message,
      );
      reflectionScheduler = null;
    }
  }

  logger.info('Sidebar bootstrap 完成', {
    mainModel: mainProvider.model,
    auxUseMain: isUseMain(auxConfig),
    embUseMain: isUseMain(embConfig),
    hasEmbedding: !!embeddingProvider,
    reflectionEnabled: !!reflectionScheduler,
    memoryKind: 'remote',
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
    reflectionScheduler,
    auxLLM,
    embeddingProvider,
    missingConfig,
  };
}
