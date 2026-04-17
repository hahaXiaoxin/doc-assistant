import { defineConfig } from 'vitest/config';

/**
 * 根 Vitest 配置
 * ---------------------------------------------
 * - 所有子包的测试通过根 `pnpm test` 运行
 * - 默认环境 node；页面提取类测试在 tools 包中单独覆盖 environment 为 happy-dom
 */
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx'],
    environment: 'node',
    globals: false,
    clearMocks: true,
    reporters: 'default',
  },
});
