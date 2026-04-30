import { defineConfig } from 'vitest/config';

/**
 * 根 Vitest 配置
 * ---------------------------------------------
 * - 所有子包的测试通过根 `pnpm test` 运行
 * - 默认环境 happy-dom（tools 层页面提取需 DOM；provider/agent 用 node 即可，
 *   但 happy-dom 环境下 node 能力也能正常使用）
 * - v0.5.0 PR-2：apps/extension 下开始出现小规模单测（如 offscreen/reflection-bridge），
 *   一并纳入执行。
 */
export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'packages/**/*.test.tsx',
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
    ],
    environment: 'happy-dom',
    globals: false,
    clearMocks: true,
    reporters: 'default',
  },
});
