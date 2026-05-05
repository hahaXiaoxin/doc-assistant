/**
 * 配置页入口
 * ---------------------------------------------
 * - 独立 HTML 页面，通过 chrome-extension://<id>/src/options/options.html 访问
 * - 使用 @doc-assistant/ui 的 OptionsForm
 * - 注入 chrome.storage.local 的类型化 TypedStorage
 * - v0.5.0：记忆浏览器 Tab 使用 `RemoteMemoryStore`，通过 RPC 转发到 offscreen
 *   document 执行；与 sidebar / SW 共享同一份扩展 origin 下的 IDB，彻底解决
 *   v0.4.0 "记忆浏览器空表"的问题。
 */
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  createLogger,
  createTypedStorage,
  setLogPersistor,
  type StorageSchema,
} from '@doc-assistant/shared';
import { RemoteMemoryStore, type MemoryStore } from '@doc-assistant/memory';
import { OptionsForm } from '@doc-assistant/ui';
import { createRemoteLogPersistor } from '../shared-logger-persistor';

const logger = createLogger('extension:options');

// v0.6.0:options 日志通过 RPC 推给 offscreen 落盘
setLogPersistor(createRemoteLogPersistor('options'));

const container = document.getElementById('options-root');
if (!container) {
  throw new Error('找不到 #options-root 挂载点');
}

const storage = createTypedStorage<StorageSchema>();

void (async () => {
  const memory: MemoryStore = new RemoteMemoryStore();
  logger.info('options 已装配 RemoteMemoryStore（记忆浏览器走 offscreen 代理）');

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
