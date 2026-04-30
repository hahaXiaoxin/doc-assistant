/**
 * Offscreen Document 入口（v0.5.0）
 * ---------------------------------------------
 * 职责：
 * - 在扩展 origin 下持有 **唯一** 一份 DexieMemoryStore（所有域名共享）
 * - 监听 chrome.runtime.onMessage 的 MEMORY_RPC_REQUEST，反射派发到 store 对应方法
 * - embedQuery callback 在这里构造（走千问 embedding API），不跨 RPC
 *
 * PR-1 作用域：只做 MemoryStore RPC 骨架；反思 Job / PAGE_VISIT_ENDED 监听
 *            留给 PR-2（届时会在本文件内再装 Runner/Scheduler）。
 *
 * 日志前缀：[extension:offscreen:memory]
 */
import {
  DEFAULT_EMBEDDING_PROVIDER_CONFIG,
  DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK,
  DEFAULT_MAIN_PROVIDER_CONFIG,
  DEFAULT_MEMORY_SETTINGS,
  MessageType,
  STORAGE_KEYS,
  createLogger,
  createTypedStorage,
  isUseMain,
  type EmbeddingProviderConfig,
  type LLMProviderConfig,
  type MemoryRpcResponse,
  type ProviderConfigOrRef,
  type StorageSchema,
} from '@doc-assistant/shared';
import { QwenEmbeddingProvider } from '@doc-assistant/provider';
import type { EmbeddingProvider } from '@doc-assistant/provider';
import {
  DexieMemoryStore,
  dispatchMemoryRpc,
  isMemoryRpcRequest,
  type MemoryStore,
} from '@doc-assistant/memory';

const logger = createLogger('extension:offscreen:memory');

logger.info('offscreen document 启动（统一记忆宿主）');

/* ------------------------------------------------------------------ */
/* 1. 构造 DexieMemoryStore（含 embedQuery）                            */
/* ------------------------------------------------------------------ */

async function bootstrapStore(): Promise<MemoryStore> {
  const storage = createTypedStorage<StorageSchema>();
  const [mainStored, embStored, memStored] = await Promise.all([
    storage.get(STORAGE_KEYS.MAIN_PROVIDER_CONFIG),
    storage.get(STORAGE_KEYS.EMBEDDING_PROVIDER_CONFIG),
    storage.get(STORAGE_KEYS.MEMORY_SETTINGS),
  ]);

  const mainProvider: LLMProviderConfig = mainStored
    ? { ...DEFAULT_MAIN_PROVIDER_CONFIG, ...mainStored }
    : DEFAULT_MAIN_PROVIDER_CONFIG;
  const embConfig: ProviderConfigOrRef<EmbeddingProviderConfig> =
    embStored ?? DEFAULT_EMBEDDING_PROVIDER_CONFIG;
  const memorySettings = { ...DEFAULT_MEMORY_SETTINGS, ...(memStored ?? {}) };

  // Embedding Provider（失败不阻塞；memory 降级到关键词召回）
  let embeddingProvider: EmbeddingProvider | null = null;
  try {
    if (isUseMain(embConfig)) {
      // 仅当主 Provider 填了 apiKey 才构造（否则 embed 调用必失败，没意义）
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

  return store;
}

/* ------------------------------------------------------------------ */
/* 2. 启动：构造 store，挂 onMessage 监听                                */
/* ------------------------------------------------------------------ */

// store 构造异步；在其就绪前收到的 RPC 先入队，ready 后逐条处理
let storeReady: Promise<MemoryStore> | null = null;

function ensureStoreReady(): Promise<MemoryStore> {
  if (!storeReady) {
    storeReady = bootstrapStore().catch((err) => {
      logger.error('DexieMemoryStore 构造失败', (err as Error).message);
      // 重置以允许下次 RPC 触发重试
      storeReady = null;
      throw err;
    });
  }
  return storeReady;
}

// offscreen 启动时立即构造（不阻塞消息监听注册）
void ensureStoreReady();

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if (!isMemoryRpcRequest(message)) {
      // 非 memory RPC 消息交给其它 listener（例如 SW 的 TOGGLE_SIDEBAR）
      return false;
    }

    // 异步处理：必须返回 true，保持 sendResponse 通道
    void (async () => {
      try {
        const store = await ensureStoreReady();
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
