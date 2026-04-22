/**
 * ESLint 根配置
 *
 * 关键约束：
 * 1. Agent 层（packages/agent）严禁直接 import `ai` 或 `@ai-sdk/*`，
 *    必须通过 LLMProvider 接口使用 —— 通过 overrides + no-restricted-imports 强制。
 * 2. Memory 层（packages/memory）MVP 严禁依赖 `dexie`（只留接口与 NullMemoryStore）。
 * 3. Tools 层（packages/tools）MVP 严禁依赖 `tesseract.js`。
 * 4. 禁止裸 console；使用 `packages/shared` 的 logger（logger 内部可使用 console）。
 */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
    webextensions: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  overrides: [
    /**
     * 架构红线：Agent 层禁止依赖 LLM 厂商 SDK
     * ---------------------------------------------
     * Agent 只能通过 packages/provider 暴露的 LLMProvider 接口访问大模型，
     * 禁止直接 import `ai` / `@ai-sdk/*`，否则 Provider 抽象失去意义。
     */
    {
      files: ['packages/agent/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'ai',
                message:
                  '[架构约束] Agent 层禁止直接 import `ai`，请通过 LLMProvider 接口（packages/provider）使用。',
              },
            ],
            patterns: [
              {
                group: ['@ai-sdk/*'],
                message:
                  '[架构约束] Agent 层禁止直接 import `@ai-sdk/*`，请通过 LLMProvider 接口（packages/provider）使用。',
              },
            ],
          },
        ],
      },
    },
    /**
     * v0.2 起：Memory 层解除 dexie 约束（PHASE2 已落地）
     * ---------------------------------------------
     * v0.1 MVP 仅保留接口与 NullMemoryStore，禁止 dexie；
     * v0.2 起 DexieMemoryStore 落地（见 docs/ROADMAP.md §2），memory 层可直接依赖 dexie。
     * 其它包（agent / tools / ui / provider）仍然不得依赖 dexie，统一走 MemoryStore 接口。
     */
    {
      files: ['packages/memory/**/*.{ts,tsx}'],
      rules: {
        // 本块曾禁止 import 'dexie'，v0.2 起不再限制。
      },
    },
    /**
     * MVP 约束：Tools 层禁止引入 OCR 实现
     * ---------------------------------------------
     * MVP 只定义 OCRStrategy 接口骨架；Phase 3 实现（见 docs/ROADMAP.md §3）。
     */
    {
      files: ['packages/tools/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'tesseract.js',
                message:
                  '[MVP 约束] Tools 层 MVP 不接入 tesseract.js，OCR 接口骨架即可。详见 docs/ROADMAP.md §3。',
              },
            ],
          },
        ],
      },
    },
    /**
     * 测试文件放宽
     */
    {
      files: ['**/*.test.{ts,tsx}', '**/__tests__/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
      },
    },
  ],
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    'coverage',
    '*.d.ts',
    'pnpm-lock.yaml',
    '**/vite.config.ts',
    '**/vitest.config.ts',
  ],
};
