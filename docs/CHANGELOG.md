# Doc Assistant · 变更日志（CHANGELOG）

> 仅记录**对外可见行为**或**架构/约定**上的变动。纯 refactor、测试补充等不记录。
> 格式参考 [Keep a Changelog](https://keepachangelog.com/)，日期为 UTC+8。

---

## [Unreleased]

- v0.2.1 将在 v0.2.0 基础上实装：辅助 LLM 调用链、反思 Job 执行器、召回机制、
  `/recall` / `/topic` 命令、WorkingMemory 工具与 UI 卡片、Persona 审核 UI

---

## [v0.2.0] · 进行中 · Phase 2 记忆层基础设施

> 本版本引入"类人脑分层记忆"架构的基础设施，完成从"聊天窗口即上下文"到"按需组装上下文"
> 的思维范式切换。相关讨论定稿见 `docs/ROADMAP.md §2`。

### Added

- **三套 Provider 配置**：`MAIN_PROVIDER_CONFIG` / `AUX_PROVIDER_CONFIG` /
  `EMBEDDING_PROVIDER_CONFIG`，辅助与 embedding 均支持"复用主 Provider"开关。
- **`@doc-assistant/provider`**：新增 `EmbeddingProvider` 接口与 `QwenEmbeddingProvider`
  实现（OpenAI 兼容 `/embeddings` 端点，支持 `text-embedding-v2`/`v3`，单次 batch ≤ 25）。
- **`@doc-assistant/memory`**：`DexieMemoryStore` 完整落地
  - 6 张表：`episodes_msg` / `episodes_visit_summary` / `persona` / `session_topics`
    / `working_memories` / `reflection_tasks` / `page_visits`
  - 纯 JS 余弦相似度 + Top-K 召回（`< 5000` 条量级内存扫足够）
  - WorkingMemory LRU 软 TTL 与归档到 `episodes_visit_summary` 的转换
  - 集成 `shared.redactSensitive` 做敏感信息过滤
- **`@doc-assistant/agent`**：
  - `PageVisitManager`：UI 边界的统一抽象（替代 session 概念），管理
    visit 启停、URL 变化切换、`/new` 命令重启、订阅事件
  - 3 个新 ContextSource：`PersonaSource`（60）、`SessionTopicSource`（55）、
    `WorkingMemorySource`（50）；工厂函数 `buildDefaultPhase2_0Sources`
  - `createChatAgent` 新增 `phase2: boolean` 开关
- **`@doc-assistant/shared`**：
  - `url-normalize`：`canonicalizeUrl` / `normalizeUrlString` / `extractDomain`，
    canonical/og:url 优先 + 剥离 UTM/fbclid/gclid/hash/结尾斜杠
  - `sensitive-filter`：`redactSensitive` 支持 email / 手机号 / 身份证 / API Key
    （sk-/ghp_/AKID/JWT 等）/ 信用卡号，默认启用
  - `clampMaxTurns` 辅助函数（`[3, 15]` 夹取）
- **配置页 Tab 重构**：
  - 基础：主 Provider + 对话行为 + 测试连接
  - 记忆：辅助 Provider / Embedding Provider（含"复用主模型"开关）/ 敏感过滤 /
    反思 Job / WorkingMemory TTL / Persona 自动确认阈值
  - 高级：`maxTurns`（3~15，默认 8）
  - 调试：预留（日志、审计、数据导出）
- **`ProviderConfigForm`** 复用组件：统一 Provider 配置的 UI（baseURL +
  model + apiKey + useMain 开关）
- **Service Worker**：`manifest.json` 新增 `alarms` 权限；注册
  `doc-assistant.reflection-scan` alarm（60 分钟周期）。v0.2.0 占位，v0.2.1
  实装扫描/执行。
- **v0.1 → v0.2 自动迁移**：bootstrap 检测旧 `QWEN_CONFIG` 时自动迁移到
  `MAIN_PROVIDER_CONFIG`，用户无感升级。

### Changed

- **Agent Loop 最后一轮兜底（纯 A 方案）**：`packages/agent/src/loop.ts`
  - 默认 `maxTurns` 从 5 提升到 8（可在配置页调整，范围 `[3, 15]`）
  - 最后一轮强制**不传 tools**，并在 messages 末尾追加临时 system 提醒
    "已达到工具调用上限，请基于已有信息给出最终回答"
  - 最后一轮若 LLM 仍返回 `tool-call`，代码**忽略**（不 yield、不执行、不 push）
  - 最后一轮完全无输出时 yield `error` + `finish:error`，UI 显示"网络不佳，
    请检查网络或查看日志"（不做假文字兜底）
- **MemoryRecord 类型扩展**：`type` 联合追加 `'persona' | 'visit_summary'`；
  新增可选字段 `visitId` / `orderInVisit` / `canonicalUrl` / `role`；
  旧类型（`'message' | 'summary' | 'fact' | 'reference'`）保留兼容
- **MemoryStore 接口扩展**：`remember/recall` 签名不变；新增可选方法
  `getWorkingMemory` / `setWorkingMemory` / `touchWorkingMemory` /
  `archiveStaleWorkingMemories` / `listPersonas` / `addPersonaCandidate` /
  `updatePersona` / `setSessionTopic` / `getSessionTopic` /
  `enqueueReflection` / `listPendingReflections` / `updateReflection` /
  `recordPageVisit` / `close`。`NullMemoryStore` 提供 no-op 兜底。
- **AgentInvokeContext**：`page` 新增可选 `canonicalUrl` / `domain`；顶层新增
  可选 `visitId`；由 sidebar 在调用 Agent 前注入，用于 Phase2 ContextSource

### Infrastructure

- **ESLint**：memory 层解除 `dexie` 约束（仅限 `packages/memory/**`）；Agent / Tools
  的约束完全不动
- `packages/memory/package.json` 新增依赖 `dexie@^4`；devDependency `fake-indexeddb@^6`
- 测试总量从 44 提升到 **187**（新增 ~143 个）

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
