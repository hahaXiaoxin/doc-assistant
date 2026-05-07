# Doc Assistant

> **Context-aware AI reading assistant for your browser — with memory.**
>
> 在任意网页右侧提供带长期记忆、上下文感知的大模型对话面板，帮你更高效地阅读文档、读论文、啃源码。

<!-- 徽章区（开源发布前占位，数值待真实化；详见 B-008） -->
![License](https://img.shields.io/badge/license-TBD-lightgrey)
![Version](https://img.shields.io/badge/version-0.6.0--beta.1-blue)
![Manifest](https://img.shields.io/badge/Chrome-MV3-success)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)
![Built with pnpm](https://img.shields.io/badge/built%20with-pnpm%20workspace-orange)

---

## 这是什么

Doc Assistant 是一款浏览器扩展（Chrome / Edge，Manifest V3），在任意网页右侧注入一个可折叠的对话面板。它与普通"把 ChatGPT 套个插件壳"的工具不同，核心差异在三点：

1. **带记忆**：把 AI 助手从"单次问答"升级为"会记住你"。内置四层记忆系统（Persona / 事件 / 情景 / 工作记忆），对话不会随页面关闭而消失。
2. **上下文感知**：自动识别页面正文、支持划词引用、按需检索历史记忆，把"你在这一页上看了什么"和"过去你怎么做过"一起喂给模型。
3. **本地优先**：所有记忆都保存在浏览器本地的 IndexedDB（通过 Offscreen Document 跨域名共用一套 DB），不经过任何第三方服务；LLM 调用直接走你填入的 API Key 和 baseURL，中间没有我们的服务器。

适合谁：长时间在浏览器里读论文 / 技术文档 / 源码 / 长文的开发者、研究者、学习者。

---

## 核心能力

> 以下能力均为**当前版本已落地**的功能，来源见 [`plan.md`](./plan.md) 的 ✅ 条目。

### 🧠 类人脑分层记忆系统

四层记忆各司其职，而不是把所有历史都塞进 prompt：

- **Persona**：关于"助手应该如何行事"和"用户是怎样的人"的稳定画像，常驻 system prompt
- **Episodic**：消息级 + visit 摘要级两级粒度的长期历史，**默认不注入、按需召回**
- **SessionTopic**：当前页面的话题焦点，辅助 LLM 每 3–5 轮自动识别
- **WorkingMemory**：按页面绑定的 TODO / ActiveGoal，让助手知道"当前正在做什么"

### 📎 划词即用的上下文引用

在页面上划词，一键作为可视化标签插入输入框，作为结构化引用注入对话（基于 Lexical `ReferenceNode`）；页面正文会被自动识别并按需作为上下文加入。

### 🔍 语义记忆召回

当问题涉及历史时，走"关键词粗判 → 辅助 LLM 精判 → 向量 topK → 邻居消息拼接"的召回链路；同时支持自然语言的时间维查询（例如"上周我看的那篇……"）自动路由到 `list_recent_visits`。

### ✍️ 异步反思，主动沉淀

每次页面访问结束后，在后台异步生成 visit 摘要 + embedding，并自动抽取 Persona 候选交给你审核——对话过程本身零阻塞。

### 🧩 三套 Provider 独立配置

主对话 / 辅助任务（主题识别 · 召回精判 · 反思）/ Embedding 三套 Provider 独立配置，支持"复用主 Provider"。

**已支持的 Provider**（v0.6.0-beta.2）：

| Provider | 主对话 | 辅助 | Embedding | 亮点 |
| --- | --- | --- | --- | --- |
| **千问 Qwen**（阿里云百炼 OpenAI 兼容端点） | ✅ | ✅ | ✅ `text-embedding-v3`/`v2` | chat / tool call / reasoning（qwen3 系列）/ embedding / rerank 全能 |
| **DeepSeek**（`https://api.deepseek.com`） | ✅ | ✅ | — | `deepseek-v4-flash`（低成本快响应）/ `deepseek-v4-pro`（主力档）。若上游自发返回 `reasoning_content`，UI 仍走 `ThinkingBlock` 折叠展示；官方无 embedding 服务 |

**推荐组合**：主对话 + 辅助 = DeepSeek（性价比最优的中文模型之一） / Embedding = Qwen `text-embedding-v3`。配置页会在检测到"主 Provider 为 DeepSeek 且 embedding 仍复用主 Provider"时给出一键切换按钮。

更多 Provider（OpenAI / Moonshot / Anthropic / Ollama）见[路线图](#路线图)。

### 🛠️ 主 LLM 可调用的记忆工具

主模型通过 7 个细粒度 tool（读/写 WorkingMemory、`remember_persona`、`recall_memory`、`list_recent_visits` 等）主动维护记忆，而不只是被动读取。

### ⌨️ 斜杠命令

- `/new`：开启新会话（保留记忆，只切分话题）
- `/recall <关键词>`：显式召回历史
- `/topic [<文本>]`：识别或手动设置当前话题

### 🎨 轻量但完整的对话 UI

侧边对话框通过 Shadow DOM 完全样式隔离，不会被任何网站 CSS 污染；支持流式响应、思考过程折叠、Markdown / GFM / 代码高亮 (Shiki) / 表格 / 任务列表、宽度拖拽、可视化引用 chip。

### 🔒 本地优先、隐私友好

- 记忆数据库位于扩展 origin 的 Offscreen Document（v0.5.0 起），所有浏览页面共享同一份 DB，**不经任何远端**。
- LLM 请求直发到你填入的 baseURL；插件不会自动访问任何 host，仅在你发起对话或手动"测试连接"时才会发起网络请求。
- 详见 [`docs/PRIVACY.md`](./docs/PRIVACY.md)。

### 🗂️ 可视化的记忆浏览器

独立配置页提供 Tab 分页（基础 / 记忆 / 记忆浏览器 / 高级 / 调试），用户可见、可审、可删除 Persona 条目。

---

## 截图 / 演示

<!-- TODO(B-008): 补充实际截图：侧边对话框 / 记忆审核 / 记忆浏览器 / 配置页 -->
<!-- 建议截图清单：
  1. 侧边对话框整体布局 + 流式回复 + 思考折叠
  2. 划词引用 chip 插入输入框
  3. Persona 审核 banner
  4. 记忆浏览器 Tab（agent / user 两列）
  5. 配置页 Provider 分组
-->

> 截图素材尚在准备中，欢迎 PR 补充。

---

## 安装使用

### 方式一：从 Release 安装（即将提供）

> 首个公开 Release 发布后会在这里提供 `.zip` 下载与 Chrome Web Store 链接。在此之前请走"从源码构建"。

### 方式二：从源码构建

**环境要求**：Node.js ≥ 18.18、pnpm ≥ 9、Chrome / Edge ≥ 109（`chrome.offscreen` API 要求）。

```bash
pnpm install
pnpm build:ext        # 产出 apps/extension/dist/
```

加载到浏览器：

1. 打开 `chrome://extensions`（Edge：`edge://extensions`）
2. 打开「开发者模式」
3. 点击「加载已解压的扩展程序」→ 选择 `apps/extension/dist/`
4. 点击工具栏图标 → 打开配置页，填入 LLM 的 API Key / baseURL / model，即可在任意页面使用

---

## 架构概览

Monorepo（pnpm workspace），依赖方向严格单向：`extension → ui → agent → provider / tools / memory → shared`。

```
apps/
  extension/       Chrome MV3 扩展宿主（入口；service worker / content script / options / offscreen）
packages/
  ui/              视图层：React + Ant Design + styled-components + Lexical 编辑器
  agent/           Agent 层：Agent Loop、ContextSource 组装、反思 Runner、PageVisit 管理
  provider/        Provider 层：LLMProvider / EmbeddingProvider 接口 + OpenAICompatible 基类 + Qwen / DeepSeek 实现 + Provider Registry
  tools/           Tools 层：页面提取、记忆相关 tool、时间维查询等
  memory/          记忆层：四层记忆 schema + DexieMemoryStore + RemoteMemoryStore 消息代理
  shared/          公共类型与工具（URL 归一化 / 敏感信息过滤等）
docs/              设计原则、路线图、需求文档、隐私政策、审核模板、踩坑沉淀
```

**架构红线**（由 ESLint 强约束，详见 `docs/ROADMAP.md`）：

- Agent 层禁止直接 `import 'ai'` 或 `@ai-sdk/*`，必须通过 `LLMProvider` 接口
- `MemoryStore.remember / recall` 签名不得修改，新增方法一律可选
- ContextSource priority 严格按 ROADMAP §2 约定（100 / 80 / 70 / 60 / 55 / 50 / 40 / 10）分配

---

## 开发指南

```bash
pnpm install
pnpm dev              # 启动扩展开发模式（HMR，产出到 apps/extension/dist/）
pnpm build            # 全量构建（所有 packages + extension）
pnpm build:ext        # 仅构建扩展

pnpm test             # 运行 Vitest 单测（环境：happy-dom）
pnpm test:watch       # 监听模式

pnpm lint             # ESLint 检查（同时校验架构红线）
pnpm lint:fix         # 自动修复
pnpm format           # Prettier 格式化
pnpm format:check     # 检查格式是否符合
pnpm typecheck        # TypeScript 类型检查（tsc -b）
```

开发约定请优先阅读 [`docs/ROADMAP.md`](./docs/ROADMAP.md)（设计原则 + 架构红线）和 [`plan.md`](./plan.md)（能力点索引）。

---

## 路线图

> 完整路线见 [`docs/ROADMAP.md`](./docs/ROADMAP.md)；未排期需求池见 [`docs/backlog.md`](./docs/backlog.md)；能力点单页索引见 [`plan.md`](./plan.md)。

近期（~1 个月内）重点：

- 🚧 **v0.5.1 · 接入 DeepSeek**（主对话 / 辅助 / R1 `reasoning_content` 折叠展示）
- 🚧 **Persona 抽取边界显式化**（降低审核队列噪音）
- 🚧 **记忆审核文案修正**（消除"关于你/关于用户"的指代歧义）
- 🚧 **气泡内引用标签富媒体化**（文本 / 图片 / DOM 快照可扩展）
- 🚧 **Token 用量看板**

远期方向（摘要）：自定义智能体、subAgent、Skills、域名级 DSL 自学习提取器、OCR 与多模态、CheckerAgent 实时提醒、E2EE 云端同步等。

---

## 贡献

欢迎 Issue / PR。提 Issue 时请尽量附上浏览器版本、扩展版本、复现步骤；提 PR 时请先阅读 `docs/ROADMAP.md` 的设计原则与架构红线，确保依赖方向与 ESLint 约束不被破坏。

> `CONTRIBUTING.md`、Issue / PR 模板、CI 徽章真实化正在整理中，详见 [`docs/backlog.md`](./docs/backlog.md) `B-008 · 开源仓库基础设施`。

---

## 相关文档

| 文档 | 说明 |
| --- | --- |
| [`plan.md`](./plan.md) | 全项目能力点索引（已实现 / 在建 / 未实现 · 单页仪表盘） |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | 版本路线、设计原则、架构红线 |
| [`docs/backlog.md`](./docs/backlog.md) | 未排期需求池（B-001 ~ B-008） |
| [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) | 版本变更记录 |
| [`docs/PRIVACY.md`](./docs/PRIVACY.md) | 隐私政策与 `<all_urls>` 权限说明 |
| [`docs/CWS-REVIEW-NOTES.md`](./docs/CWS-REVIEW-NOTES.md) | Chrome Web Store 审核 justification 模板 |
| [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) | Shadow DOM / Lexical / 流式 / CORS 等踩坑沉淀 |
| [`docs/v0.2-DESIGN-HISTORY.md`](./docs/v0.2-DESIGN-HISTORY.md) | v0.2 大版本：从 MVP 到四层记忆的设计史 |
| [`docs/v0.4-v0.5-DESIGN-HISTORY.md`](./docs/v0.4-v0.5-DESIGN-HISTORY.md) | v0.4–v0.5 可见记忆 · Offscreen 架构设计史 |
| [`docs/requirements/`](./docs/requirements) | 正式需求说明（按版本归档） |

---

## License

**License 待定** —— 将在首个公开 Release 前确定。候选：MIT / Apache-2.0（由项目所有者最终拍板）。在 LICENSE 文件落地之前，默认保留所有权利。

---

## 致谢

本项目构建于一众优秀的开源项目之上，特别鸣谢：

- [React](https://react.dev/) · [Ant Design](https://ant.design/) · [styled-components](https://styled-components.com/) · [Lexical](https://lexical.dev/)
- [Vite](https://vitejs.dev/) · [`@crxjs/vite-plugin`](https://crxjs.dev/vite-plugin) · [Vitest](https://vitest.dev/)
- [Dexie.js](https://dexie.org/) · [Mozilla Readability](https://github.com/mozilla/readability) · [Shiki](https://shiki.style/)
- [Vercel AI SDK](https://sdk.vercel.ai/)（仅 Provider 层内部使用）

以及所有愿意试用、提 Issue、发 PR 的朋友 —— 欢迎加入。
