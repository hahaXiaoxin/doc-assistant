/**
 * Offscreen Document 入口（v0.5.0）
 * ---------------------------------------------
 * 职责：
 * - 在扩展 origin 下持有 **唯一** 一份 DexieMemoryStore（所有域名共享）
 * - 监听 chrome.runtime.onMessage 的 MEMORY_RPC_REQUEST，反射派发到 store 对应方法
 * - embedQuery callback 在这里构造（走千问 embedding API），不跨 RPC
 * - **v0.5.0 PR-2**：ReflectionRunner / ReflectionScheduler 从 sidebar 迁到这里；
 *   监听 SW 转发的 `REFLECTION_TICK`（alarm tick）与 sidebar 转发的
 *   `PAGE_VISIT_ENDED`（visit 结束即时触发），内部调 `scheduler.runPending()`。
 *   §8 "SW 唤醒 sidebar 跑反思"的广播绕路至此被彻底删除。
 *
 * 日志前缀：
 * - [extension:offscreen:memory]（RPC 路径）
 * - [extension:offscreen:reflection]（反思 Job 路径，方便真机调试）
 */
import {
  DEFAULT_AUX_PROVIDER_CONFIG,
  DEFAULT_EMBEDDING_PROVIDER_CONFIG,
  DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK,
  DEFAULT_MAIN_PROVIDER_CONFIG,
  DEFAULT_MEMORY_SETTINGS,
  MessageType,
  STORAGE_KEYS,
  createLogger,
  isUseMain,
  setLogPersistor,
  type EmbeddingProviderConfig,
  type LLMProviderConfig,
  type LogEntry,
  type MemoryRpcResponse,
  type MemorySettings,
  type OffscreenStorageReadRequest,
  type OffscreenStorageReadResponse,
  type ProviderConfigOrRef,
} from '@doc-assistant/shared';
import { QwenEmbeddingProvider, QwenProvider } from '@doc-assistant/provider';
import type { EmbeddingProvider, LLMProvider } from '@doc-assistant/provider';
import {
  DexieMemoryStore,
  dispatchMemoryRpc,
  isMemoryRpcRequest,
  type MemoryStore,
} from '@doc-assistant/memory';
import {
  ReflectionRunner,
  ReflectionScheduler,
} from '@doc-assistant/agent';
import { installReflectionBridge } from './reflection-bridge';
import { installLogBridge, persistLogsDirectly } from './log-bridge';

const logger = createLogger('extension:offscreen:memory');
const reflectionLogger = createLogger('extension:offscreen:reflection');

logger.info('offscreen document 启动（统一记忆宿主）');

// offscreen 自己的 logger 不走 RPC,直接写本地 IDB
setLogPersistor((entries: LogEntry[]) => {
  void persistLogsDirectly(entries, 'offscreen').catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[offscreen] 日志落盘失败', (err as Error).message);
  });
});

/* ------------------------------------------------------------------ */
/* 1. 构造 DexieMemoryStore（含 embedQuery）+ Aux LLM + 反思 Scheduler */
/* ------------------------------------------------------------------ */

interface OffscreenRuntime {
  store: MemoryStore;
  /** 当反思开关关闭 / 初始化失败时为 null，不影响 RPC 路径 */
  scheduler: ReflectionScheduler | null;
}

/**
 * 通过 SW 代理读取 chrome.storage.local（v0.5.0 hotfix）。
 *
 * Chrome 官方：offscreen 只支持 chrome.runtime，不支持 chrome.storage（
 * 详见 https://developer.chrome.com/docs/extensions/reference/api/offscreen ）。
 * 这里向 SW 发 OFFSCREEN_STORAGE_READ_REQUEST，SW 用 TypedStorage 读后回响应。
 *
 * 容错：SW 冷启动 / listener 未注册时 sendMessage 可能 resolve 为 undefined——
 * bootstrap 阶段允许短暂重试（最多 3 次，与 RemoteMemoryStore transport 重试
 * 策略一致）；仍拿不到就抛错，由上层的 ensureRuntimeReady catch 后标记失败。
 */
async function fetchStorageViaServiceWorker(
  keys: string[],
): Promise<Record<string, unknown>> {
  const rpcId = `offscreen-storage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const req: OffscreenStorageReadRequest = {
    type: MessageType.OFFSCREEN_STORAGE_READ_REQUEST,
    rpcId,
    keys,
  };
  const maxRetries = 3;
  const baseDelayMs = 150;
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const raw = (await chrome.runtime.sendMessage(req)) as unknown;
      if (
        raw &&
        typeof raw === 'object' &&
        (raw as { type?: unknown }).type === MessageType.OFFSCREEN_STORAGE_READ_RESPONSE
      ) {
        const resp = raw as OffscreenStorageReadResponse;
        if (!resp.ok) {
          throw new Error(resp.error?.message ?? 'OFFSCREEN_STORAGE_READ failed');
        }
        return resp.values ?? {};
      }
    } catch (err) {
      // 最后一次仍失败则抛出
      if (attempt === maxRetries) throw err;
    }
    if (attempt < maxRetries) await sleep(baseDelayMs * (attempt + 1));
  }
  throw new Error('OFFSCREEN_STORAGE_READ 未取得合法响应（SW 未挂 bridge？）');
}

async function bootstrapRuntime(): Promise<OffscreenRuntime> {
  // hotfix：offscreen 下 chrome.storage 不可用，必须走 SW 代理
  const storageValues = await fetchStorageViaServiceWorker([
    STORAGE_KEYS.MAIN_PROVIDER_CONFIG,
    STORAGE_KEYS.AUX_PROVIDER_CONFIG,
    STORAGE_KEYS.EMBEDDING_PROVIDER_CONFIG,
    STORAGE_KEYS.MEMORY_SETTINGS,
  ]);
  const mainStored = storageValues[STORAGE_KEYS.MAIN_PROVIDER_CONFIG] as
    | LLMProviderConfig
    | undefined;
  const auxStored = storageValues[STORAGE_KEYS.AUX_PROVIDER_CONFIG] as
    | ProviderConfigOrRef<LLMProviderConfig>
    | undefined;
  const embStored = storageValues[STORAGE_KEYS.EMBEDDING_PROVIDER_CONFIG] as
    | ProviderConfigOrRef<EmbeddingProviderConfig>
    | undefined;
  const memStored = storageValues[STORAGE_KEYS.MEMORY_SETTINGS] as
    | Partial<MemorySettings>
    | undefined;

  const mainProvider: LLMProviderConfig = mainStored
    ? { ...DEFAULT_MAIN_PROVIDER_CONFIG, ...mainStored }
    : DEFAULT_MAIN_PROVIDER_CONFIG;
  const auxConfig: ProviderConfigOrRef<LLMProviderConfig> =
    auxStored ?? DEFAULT_AUX_PROVIDER_CONFIG;
  const embConfig: ProviderConfigOrRef<EmbeddingProviderConfig> =
    embStored ?? DEFAULT_EMBEDDING_PROVIDER_CONFIG;
  const memorySettings = { ...DEFAULT_MEMORY_SETTINGS, ...(memStored ?? {}) };

  /* ---- Embedding Provider（失败不阻塞；memory 降级到关键词召回） ---- */
  let embeddingProvider: EmbeddingProvider | null = null;
  try {
    if (isUseMain(embConfig)) {
      if (mainProvider.apiKey.trim()) {
        embeddingProvider = new QwenEmbeddingProvider({
          apiKey: mainProvider.apiKey,
          baseURL: mainProvider.baseURL,
          model: DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK.model,
          dimension: DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK.dimension,
        });
      } else {
        logger.warn('主 Provider 未配置 apiKey，embedding 暂不可用（召回降级关键词）');
      }
    } else {
      embeddingProvider = new QwenEmbeddingProvider({
        apiKey: embConfig.apiKey,
        baseURL: embConfig.baseURL,
        model: embConfig.model,
        dimension: embConfig.dimension,
      });
    }
  } catch (err) {
    logger.warn('Embedding Provider 初始化失败（不阻塞）', (err as Error).message);
  }

  /* ---- DexieMemoryStore ---- */
  const store = new DexieMemoryStore({
    sensitiveFilterEnabled: memorySettings.sensitiveFilterEnabled,
    ...(embeddingProvider
      ? {
          embedQuery: async (text: string): Promise<Float32Array> => {
            const vectors = await embeddingProvider!.embed([text]);
            return vectors[0] ?? new Float32Array();
          },
        }
      : {}),
  });

  logger.info('DexieMemoryStore 就绪', {
    sensitiveFilter: memorySettings.sensitiveFilterEnabled,
    hasEmbedding: !!embeddingProvider,
  });

  /* ---- Aux LLM（反思 Job 专用；useMain 则复用主 Provider 配置） ---- */
  // 注意：即使 mainProvider.apiKey 为空，此处仍构造 provider 占位——反思 Job
  // 触发时再实际 fetch，若 key 缺失则 runner 内部 catch 并返回 ok=false（降级）。
  let auxLLM: LLMProvider | null = null;
  try {
    if (isUseMain(auxConfig)) {
      auxLLM = new QwenProvider({
        apiKey: mainProvider.apiKey || 'placeholder',
        baseURL: mainProvider.baseURL,
        model: mainProvider.model,
        enableThinking: mainProvider.enableThinking ?? false,
      });
    } else {
      auxLLM = new QwenProvider({
        apiKey: auxConfig.apiKey,
        baseURL: auxConfig.baseURL,
        model: auxConfig.model,
        enableThinking: auxConfig.enableThinking ?? false,
      });
    }
  } catch (err) {
    reflectionLogger.warn('Aux Provider 初始化失败（反思 Job 不可用）', (err as Error).message);
  }

  /* ---- ReflectionRunner + ReflectionScheduler ---- */
  let scheduler: ReflectionScheduler | null = null;
  if (memorySettings.reflectionEnabled && auxLLM) {
    try {
      const runner = new ReflectionRunner({
        memory: store,
        aux: auxLLM,
        embedding: embeddingProvider,
      });
      scheduler = new ReflectionScheduler({ memory: store, runner });
      reflectionLogger.info('scheduler 启动, alarm=reflection-scan');
      // 启动时补跑一次（fire-and-forget）
      void scheduler.runPending().catch((err: Error) => {
        reflectionLogger.warn('启动补跑 runPending 失败', err.message);
      });
    } catch (err) {
      reflectionLogger.warn(
        'ReflectionScheduler 构建失败（反思任务将不被处理）',
        (err as Error).message,
      );
      scheduler = null;
    }
  } else {
    reflectionLogger.info(
      'scheduler 未启动',
      memorySettings.reflectionEnabled ? 'auxLLM 不可用' : 'reflectionEnabled=false',
    );
  }

  return { store, scheduler };
}

/* ------------------------------------------------------------------ */
/* 2. 启动：构造 runtime，挂 onMessage 监听                             */
/* ------------------------------------------------------------------ */

// runtime 构造异步；在其就绪前收到的 RPC 先等待 ready
let runtimeReady: Promise<OffscreenRuntime> | null = null;

function ensureRuntimeReady(): Promise<OffscreenRuntime> {
  if (!runtimeReady) {
    runtimeReady = bootstrapRuntime().catch((err) => {
      logger.error('offscreen runtime 构造失败', (err as Error).message);
      // 重置以允许下次 RPC 触发重试
      runtimeReady = null;
      throw err;
    });
  }
  return runtimeReady;
}

// offscreen 启动时立即构造（不阻塞消息监听注册）
void ensureRuntimeReady();

/* ------------------------------------------------------------------ */
/* 3. MEMORY_RPC_REQUEST 路由（PR-1 行为保留）                          */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if (!isMemoryRpcRequest(message)) {
      // 非 memory RPC 消息交给其它 listener
      return false;
    }

    // 异步处理：必须返回 true，保持 sendResponse 通道
    void (async () => {
      try {
        const { store } = await ensureRuntimeReady();
        const resp = await dispatchMemoryRpc(store, message, {
          onOk(method, elapsed) {
            logger.debug(`[memory-rpc] ${method} ${elapsed}ms ok`);
          },
          onError(method, elapsed, err) {
            logger.warn(`[memory-rpc] ${method} ${elapsed}ms err: ${err.message}`);
          },
        });
        sendResponse(resp);
      } catch (err) {
        sendResponse({
          type: MessageType.MEMORY_RPC_RESPONSE,
          rpcId: message.rpcId,
          ok: false,
          error: { message: (err as Error).message },
        } satisfies MemoryRpcResponse);
      }
    })();
    return true;
  },
);

/* ------------------------------------------------------------------ */
/* 4. REFLECTION_TICK / PAGE_VISIT_ENDED 路由（PR-2 新增）              */
/* ------------------------------------------------------------------ */

installReflectionBridge(chrome.runtime, {
  getScheduler: async () => (await ensureRuntimeReady()).scheduler,
});

/* ------------------------------------------------------------------ */
/* 5. LOG_PERSIST / LOG_EXPORT 路由(v0.6.0 Debug 导出)                 */
/* ------------------------------------------------------------------ */

installLogBridge(chrome.runtime);

/** 仅供测试直接校验 runtime 构造路径（生产代码不会 import 这个） */
export const __internal = {
  ensureRuntimeReady,
};
