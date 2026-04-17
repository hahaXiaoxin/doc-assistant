/**
 * @doc-assistant/agent · 入口
 * ---------------------------------------------
 * 职责：
 * - 多 Agent 编排（主对话 Agent、未来的 Checker Agent 等）
 * - ContextSource 抽象：每个 Agent 的上下文由多段 Source 组装而成
 * - Tool-calling loop：经典的 LLM + Tool 调用循环
 *
 * 架构红线（ESLint 强约束）：
 * - 本包严禁 `import 'ai'` 或 `import '@ai-sdk/*'`
 * - LLM 访问必须通过 @doc-assistant/provider 的 LLMProvider 接口
 *
 * PHASE3: CheckerAgent + 实时提醒，详见 docs/ROADMAP.md §4。
 */

export {};
