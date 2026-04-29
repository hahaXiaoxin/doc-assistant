/**
 * 配置页入口
 * ---------------------------------------------
 * - 独立 HTML 页面，通过 chrome-extension://<id>/src/options/options.html 访问
 * - 使用 @doc-assistant/ui 的 OptionsForm
 * - 注入 chrome.storage.local 的类型化 TypedStorage
 * - v0.4.0：构造 DexieMemoryStore 供"记忆浏览器" Tab 使用（只读 + 删/编）
 *   - 共享同一个 IDB DB（DEFAULT_DB_NAME），与 sidebar/background 看到同一份数据
 *   - 不注入 embedQuery：记忆浏览器只做 list /删除/编辑，不做向量召回
 *   - 敏感过滤默认开启（从 MemorySettings 读）
 */
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  DEFAULT_MEMORY_SETTINGS,
  STORAGE_KEYS,
  createLogger,
  createTypedStorage,
  type StorageSchema,
} from '@doc-assistant/shared';
import {
  DexieMemoryStore,
  NullMemoryStore,
  type MemoryStore,
} from '@doc-assistant/memory';
import { OptionsForm } from '@doc-assistant/ui';

const logger = createLogger('extension:options');

const container = document.getElementById('options-root');
if (!container) {
  throw new Error('找不到 #options-root 挂载点');
}

const storage = createTypedStorage<StorageSchema>();

void (async () => {
  const memStored = await storage.get(STORAGE_KEYS.MEMORY_SETTINGS);
  const memorySettings = { ...DEFAULT_MEMORY_SETTINGS, ...(memStored ?? {}) };

  let memory: MemoryStore;
  try {
    memory = new DexieMemoryStore({
      sensitiveFilterEnabled: memorySettings.sensitiveFilterEnabled,
    });
  } catch (err) {
    logger.warn('DexieMemoryStore 初始化失败，降级到 NullMemoryStore', (err as Error).message);
    memory = new NullMemoryStore();
  }

  createRoot(container).render(
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1677FF',
          borderRadius: 8,
          fontFamily: 'PingFang SC, -apple-system, Segoe UI, Roboto, sans-serif',
        },
      }}
    >
      <OptionsForm storage={storage} memory={memory} />
    </ConfigProvider>,
  );
})();
