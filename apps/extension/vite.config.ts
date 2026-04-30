import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'node:path';
import manifest from './manifest.json' with { type: 'json' };

/**
 * 扩展构建配置
 * ---------------------------------------------
 * - 使用 @crxjs/vite-plugin 读取 manifest.json 自动装配多入口：
 *   background.service_worker / content_scripts / options_ui.page
 * - sidebar 由 content script 通过动态 import 加载，crx 会自动产出对应 chunk
 * - v0.5.0 offscreen 入口：通过 rollupOptions.input 显式追加 offscreen.html
 *   （@crxjs 不自动识别 offscreen 声明；打出的 html 由 chrome.offscreen.createDocument
 *   按 URL 加载，路径为 `src/offscreen/offscreen.html`）
 * - 产出目录：apps/extension/dist/
 */
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // crx 插件接管大部分 input；offscreen 需手动声明
    rollupOptions: {
      input: {
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
      },
    },
    // modulePreload: false · 详见 docs/TROUBLESHOOTING.md §3
    // 默认 base='/' 会让 __vitePreload 生成 '/assets/xxx.js' 这种以宿主页面
    // origin 为根的绝对路径，在任意网页运行时会去宿主域请求我们的 chunk → 404
    modulePreload: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    hmr: {
      port: 5174,
    },
  },
});
