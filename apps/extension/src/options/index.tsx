/**
 * 配置页入口
 * ---------------------------------------------
 * - 独立 HTML 页面，通过 chrome-extension://<id>/src/options/options.html 访问
 * - 使用 @doc-assistant/ui 的 OptionsForm
 * - 注入 chrome.storage.local 的类型化 TypedStorage
 */
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { createTypedStorage, type StorageSchema } from '@doc-assistant/shared';
import { OptionsForm } from '@doc-assistant/ui';

const container = document.getElementById('options-root');
if (!container) {
  throw new Error('找不到 #options-root 挂载点');
}

const storage = createTypedStorage<StorageSchema>();

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
    <OptionsForm storage={storage} />
  </ConfigProvider>,
);
