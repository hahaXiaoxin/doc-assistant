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
    // crx 插件接管 rollupOptions.input，不需要手动指定
    //
    // 关键：关闭 Vite 的 modulepreload polyfill 注入。
    // 默认 base='/' 会让 __vitePreload 辅助函数生成 '/assets/xxx.js' 这种
    // 以宿主页面 origin 为根的绝对路径，导致 content script 在任意页面运行时
    // 去宿主域请求我们的 chunk（如 https://datawhalechina.github.io/assets/logger-xxx.js）→ 404
    // 实际加载 chunk 的工作由浏览器在执行 import() 时自动完成，不需要 modulepreload。
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
