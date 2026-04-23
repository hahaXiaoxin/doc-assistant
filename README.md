# Doc Assistant · 智能阅读助手浏览器插件

面向在线学习场景的 Chrome / Edge 浏览器扩展。在任意文档/文章页面右侧提供可折叠的对话面板，结合页面内容与千问大模型进行上下文感知对话，无需切换窗口或平台。

> **当前版本：v0.2.1（Phase 2 记忆层高级能力）** · 设计原则与完整规划见 [`docs/ROADMAP.md`](./docs/ROADMAP.md)

## 核心特性

- **侧边对话框**（Content Script 注入 + Shadow DOM 样式隔离，折叠/展开/宽度拖拽）
- **流式对话 + 思考过程**（reasoning）展示
- **自动识别文章身份与正文**，作为上下文注入
- **划词引用**（以可视化 tag 形式插入输入框）
- **四层记忆系统**（v0.2）：
  - **Persona（个性记忆）**：稳定偏好/事实，反思自动抽取 → 用户审核 → 注入 system prompt
  - **Episodic（事件记忆）**：消息级 + visit 摘要级两级粒度，按 canonicalUrl/visitId 索引
  - **SessionTopic（情景记忆）**：每 3-5 轮辅助 LLM 识别当前话题，对用户透明
  - **WorkingMemory（工作记忆）**：按 canonicalUrl 绑定 activeGoal + TODO，支持主 LLM 通过 7 个 tool 维护，30 天 LRU 软 TTL
- **按需召回**（v0.2.1）：关键词粗判 → 辅 LLM 精判 → 向量 topK → 邻居消息拼接
- **反思 Job**（v0.2.1）：PageVisit 结束后异步生成摘要 + embedding + 抽取 Persona 候选
- **斜杠命令**：`/new`（重启会话·保留记忆）、`/recall <关键词>`（显式召回）、`/topic [<文本>]`（识别/手动设置话题）
- **Persona 审核**：sidebar 折叠条一键接受/拒绝
- **三套 Provider**：主对话 / 辅助（主题/召回/反思） / Embedding，均支持"复用主 Provider"
- **独立配置页**：Tab 分页（基础 / 记忆 / 高级 / 调试）

## 技术栈

| 维度 | 选型 |
| --- | --- |
| 浏览器 | Chrome / Edge（Manifest V3） |
| 语言 | TypeScript 5 |
| 前端 | React 18 + Ant Design 5 + styled-components 6 |
| 富文本 | Lexical |
| 构建 | Vite 5 + `@crxjs/vite-plugin` |
| 包管理 | pnpm 9 workspace |
| LLM 协议适配 | Vercel AI SDK（仅 Provider 层内部使用） |
| 测试 | Vitest + happy-dom |

## 仓库结构

```
apps/extension              Chrome 扩展宿主（入口）
packages/ui                 视图层（React 组件、Lexical、主题）
packages/agent              Agent 层（多 Agent + ContextSource）
packages/provider           Provider 层（LLMProvider 接口 + Qwen 实现）
packages/tools              Tools 层（页面提取、截图等本地工具）
packages/memory             记忆层（MVP 仅接口 + NullMemoryStore）
packages/shared             公共类型与工具
docs/ROADMAP.md             Phase 2+ 规划
```

**依赖方向严格单向**：`extension → ui → agent → provider / tools / memory → shared`

## 快速开始

### 环境要求

- Node.js ≥ 18.18
- pnpm ≥ 9

### 安装与开发

```bash
pnpm install
pnpm dev              # 启动扩展开发模式（HMR）
```

### 构建

```bash
pnpm build            # 全量构建
pnpm build:ext        # 仅构建扩展，产出 apps/extension/dist/
```

### 加载到浏览器

1. 执行 `pnpm build:ext`
2. 打开 `chrome://extensions`（Edge：`edge://extensions`）
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」→ 选择 `apps/extension/dist/`

### 测试与检查

```bash
pnpm test             # 运行单元测试
pnpm lint             # ESLint 检查
pnpm format           # Prettier 格式化
pnpm typecheck        # TS 类型检查
```

## 配置大模型

1. 安装扩展后，点击工具栏图标 → 选择「打开配置」（或访问 `chrome-extension://<扩展ID>/options.html`）
2. 填入千问的 API Key 与模型（默认 baseURL 已预填）
3. 保存后即可在任意页面使用

## 架构红线（ESLint 强约束）

- Agent 层 **禁止** 直接 `import 'ai'` 或 `@ai-sdk/*`，必须通过 `LLMProvider` / `EmbeddingProvider` 接口
- **v0.2 起**：Memory 层 `dexie` 约束**已解除**（Phase 2 已落地 DexieMemoryStore）
- Tools 层 **禁止** 依赖 `tesseract.js`（Phase 3 才解禁）
- `MemoryStore.remember / recall` 签名不得修改；新增方法一律**可选**，`NullMemoryStore` 提供 no-op 兜底
- ContextSource priority 严格按 ROADMAP §2 约定（100 / 80 / 70 / 60 / 55 / 50 / 40 / 10），新 Source 不得占用已有数字

## 文档索引

- [`docs/ROADMAP.md`](./docs/ROADMAP.md) · 设计原则与 Phase 2+ 规划
- [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) · 版本变更记录
- [`docs/TROUBLESHOOTING.md`](./docs/TROUBLESHOOTING.md) · 踩坑沉淀（Shadow DOM / Lexical / AI SDK 流式 / 扩展 CORS 等）

## License

私有项目，暂未开源。
