/**
 * (v0.6.0-beta.2) 归一化逻辑已迁入 `packages/provider/src/openai-compatible/normalizer.ts`。
 * 本文件保留为 barrel re-export,保证现有外部/测试引用 `qwen/normalizer` 不中断。
 */
export { normalizeStreamPart, type UnknownStreamPart } from '../openai-compatible/normalizer';
