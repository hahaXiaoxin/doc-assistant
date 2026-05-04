/**
 * ESLint 根配置
 *
 * 关键约束：
 * 1. Agent 层（packages/agent）严禁直接 import `ai` 或 `@ai-sdk/*`，
 *    必须通过 LLMProvider 接口使用 —— 通过 overrides + no-restricted-imports 强制。
 * 2. Tools 层（packages/tools）暂不接入 OCR 实现（`tesseract.js`）；
 *    OCR 只保留接口骨架，详见 docs/ROADMAP.md §3。
 * 3. 禁止裸 console；使用 `packages/shared` 的 logger（logger 内部可使用 console）。
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
     * Tools 层暂不引入 OCR 实现
     * ---------------------------------------------
     * 只保留 OCRStrategy 接口骨架，真实 OCR（Tesseract.js / 多模态 LLM）见 docs/ROADMAP.md §3。
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
                  '[架构约束] Tools 层暂不接入 tesseract.js，OCR 保持接口骨架即可。详见 docs/ROADMAP.md §3。',
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
