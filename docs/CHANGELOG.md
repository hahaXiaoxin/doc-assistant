# Doc Assistant · 变更日志（CHANGELOG）

> 仅记录**对外可见行为**或**架构/约定**上的变动。纯 refactor、测试补充等不记录。
> 格式参考 [Keep a Changelog](https://keepachangelog.com/)，日期为 UTC+8。

---

## [Unreleased]

- 无

---

## [v0.1.1] · 2026-04-18 · Sidebar 真实页面可用性修复

> 本次修复集中解决 v0.1.0 在真实宿主页面下的若干阻塞性问题，
> 所有修复分析、原理与验证步骤沉淀在
> [`docs/TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)。
> 下方每条条目标注了对应章节号 `[TS §N]` 方便回查。

### Fixed

- **输入框无法打字**：Lexical 在 Shadow DOM 内因 `window.getSelection()`
  被 shadow 边界截断导致光标定位失败。新增 `patch-shadow-selection`
  在 React 挂载前包装 `window.getSelection`，当选区 anchorNode 落在
  已注册 shadowRoot 内时返回 `shadowRoot.getSelection()`。`[TS §1]`

- **Tool-calling 第一轮后无回复（核心问题）**：`runAgentLoop` 之前把
  AI SDK 每轮 HTTP 请求的 `finish` chunk 透传到 UI 层，`useStreamingChat`
  一看到 `finish` 就 `break`，触发 AsyncGenerator `return()` 反向终止
  loop，tool 来不及执行、第二轮 LLM 请求从不发起。修为：loop 内部吞
  掉中间轮次的 finish，只在整段结束时合成一个 finish 透传给 UI。
  `ChatChunk.finish` 补充语义注释。`[TS §2]`

- **构建产物在宿主页面域下 404**：Vite 默认 `base: '/'`，其
  `__vitePreload` 辅助函数生成 `<link rel="modulepreload" href="/assets/xxx.js">`，
  被宿主页面 origin 解析成 `https://宿主域/assets/xxx.js` 全部 404。
  `vite.config.ts` 设置 `build.modulePreload: false`，走 dynamic import
  自己的相对路径解析。`[TS §3]`

- **LLM 请求被 CORS 拦截**：manifest 新增 `host_permissions`
  声明千问 API 域（`dashscope.aliyuncs.com`、`dashscope-intl.aliyuncs.com`），
  允许 content script 跨源请求。`[TS §4]`

- **输入卡顿 + 宿主页面 404.thml 请求风暴**：`ChatPanel` 的
  `pageSummary` 原先每次渲染都同步跑 `runIdentityPipeline + runContentPipeline`，
  Lexical 每敲一键都触发全量 DOM 提取，在技术博客这种中等尺寸页面上
  造成秒级延迟，并附带触发宿主页面 IntersectionObserver 误判。
  改为 `useMemo([visible])`，只在面板显隐切换时重算；`send` 时
  `buildInvokeContext` 仍会即时取最新摘要。`[TS §5]`

- **划词引用无反应**：`InsertReferencePlugin` 与 `ActionsBridge` 的
  `useEffect` 执行顺序不可保证，前者尝试写入 `actionsRef.current`
  时后者尚未设值，后者后续又覆盖成空占位函数。改为
  `ActionsBridge.insertReference` 作为闭包从 `insertRef` 实时读取。
  同时 `useSelectionBridge` 从"接受函数"改为"接受 getter"，
  消除异步 register 时的闭包锁死问题。`selection-toolbar`
  改用 `document.getSelection()` 明确拿宿主页面选区，不依赖 patch 行为。
  `[TS §6]`

- **对话框样式"透明化"**：尝试加 `contain: layout style size` 后
  `backdrop-filter` 与 `background: rgba(...)` 整体失效（`contain:size`
  以 0×0 作为内容布局基准）。移除相关 containment 声明。`[TS §7]`

### Added

- `apps/extension/src/sidebar/patch-shadow-selection.ts` · Lexical
  shadow DOM 兼容补丁
- `packages/shared/src/chat.ts` · `ChatChunk.finish` 增加语义注释
- `packages/agent/src/loop.ts` · 文件头注释明确"finish 不透传"约定

### Changed

- `packages/agent/src/context/page-context.ts` · 提示语强化，
  让 LLM 更主动地在需要细节时调用 `read_page_content`
- `packages/tools/src/definitions/read-page-content.ts` · 失败路径
  改为 `throw`，让 `loop.executeTool` 统一标记 `isError`

### Infrastructure

- shadow host 加 `pointer-events: none`，`Panel` / `CollapsedFab`
  显式 `pointer-events: auto` 恢复命中测试

---

## [v0.1.0] · 2026-04-17 · MVP 首版

详见 [`README.md`](../README.md) 与
[`.codebuddy/plans/doc-assistant-mvp-v0_1_9c7dd683.md`](../.codebuddy/plans/doc-assistant-mvp-v0_1_9c7dd683.md)。
