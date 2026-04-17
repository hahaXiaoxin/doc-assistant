/**
 * 配置页入口 · commit 3 占位版
 * ---------------------------------------------
 * commit 4 会替换为完整的 antd 配置表单。此处先做占位避免 vite 构建报错。
 */
import { createRoot } from 'react-dom/client';

const container = document.getElementById('options-root');
if (container) {
  createRoot(container).render(
    <div
      style={{
        fontFamily: 'PingFang SC, -apple-system, sans-serif',
        padding: 48,
        maxWidth: 720,
        margin: '0 auto',
        color: '#1f1f1f',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 20 }}>Doc Assistant · 配置</h1>
      <p style={{ color: '#8c8c8c', marginTop: 12 }}>
        Provider 配置（API Key、模型、思考模式开关等）将在下一个 commit 接入。
      </p>
    </div>,
  );
}
