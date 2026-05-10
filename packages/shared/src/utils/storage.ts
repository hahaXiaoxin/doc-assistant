/**
 * chrome.storage.local 的 Promise 化与类型安全封装
 * ---------------------------------------------
 * - MV3 的 chrome.storage API 已支持 Promise，本文件提供类型安全的 key-value 视图
 * - 敏感信息（如 apiKey）仅通过本文件进入 chrome.storage.local，不得写入 IndexedDB、不得打印日志
 */

export interface TypedStorage<TSchema extends Record<string, unknown>> {
  get<K extends keyof TSchema>(key: K): Promise<TSchema[K] | undefined>;
  getAll(): Promise<Partial<TSchema>>;
  set<K extends keyof TSchema>(key: K, value: TSchema[K]): Promise<void>;
  setMany(partial: Partial<TSchema>): Promise<void>;
  remove<K extends keyof TSchema>(key: K): Promise<void>;
  onChanged(
    listener: (changes: Partial<TSchema>) => void,
  ): () => void;
}

/**
 * 创建一个类型化的 chrome.storage.local 视图。
 * 仅在扩展环境（chrome.storage 可用）下调用。
 */
export function createTypedStorage<
  TSchema extends Record<string, unknown>,
>(): TypedStorage<TSchema> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    throw new Error(
      '[storage] chrome.storage.local is not available in the current environment.',
    );
  }
  const store = chrome.storage.local;

  return {
    async get(key) {
      const result = await store.get(key as string);
      return result[key as string] as TSchema[typeof key] | undefined;
    },
    async getAll() {
      const result = await store.get(null);
      return result as Partial<TSchema>;
    },
    async set(key, value) {
      await store.set({ [key as string]: value });
    },
    async setMany(partial) {
      await store.set(partial as Record<string, unknown>);
    },
    async remove(key) {
      await store.remove(key as string);
    },
    onChanged(listener) {
      const handler = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: chrome.storage.AreaName,
      ) => {
        if (areaName !== 'local') return;
        const partial: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(changes)) {
          partial[k] = v.newValue;
        }
        listener(partial as Partial<TSchema>);
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
  };
}
