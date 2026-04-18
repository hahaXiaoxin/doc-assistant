# Doc Assistant · 后续迭代规划（ROADMAP）

> **本文件记录 MVP v0.1 明确不做的能力，以及其设计意图、架构预留点、实现约束与禁止事项。**
>
> 后续迭代（包括 AI 协作开发）**必须先阅读本文件**以保持架构一致性，不得在未读本文件的前提下自作主张实现下列任何内容。
>
> 文件内 `§1/§2/§3/§4` 标号与代码内 `// PHASE2:` / `// PHASE3:` 注释锚点一一对应。

---

## 版本路线

| 版本 | 主题 | 状态 |
| --- | --- | --- |
| **v0.1（MVP，当前）** | 页面内文本对话 · Provider/Agent/Tools/UI 四层架构 · 侧边对话框 · 独立配置页 · 划词引用 · 斜杠命令 | ✅ 已发布 |
| v0.2（Phase 2-a） | 记忆层落地（Dexie + remember/recall，无向量） | 规划中 |
| v0.3（Phase 2-b） | 域名级 DSL 自学习文章提取器 | 规划中 |
| v0.4（Phase 2-c） | 千问 embedding + 向量召回 + `recall_memory` tool | 规划中 |
| v0.5（Phase 3-a） | OCR 策略 · 截图工具 | 规划中 |
| v0.6（Phase 3-b） | CheckerAgent · 实时提醒（MutationObserver + 防抖） | 规划中 |
| v0.7（Phase 4） | 云端同步（选配，E2EE） | 规划中 |

---

## §1 · Phase 2-b：域名级自学习文章提取器

### 背景动机

用户在不同站点阅读时，站点 DOM 结构差异巨大：某些站点（Notion、Figma、Canvas 渲染的文档）Readability / 语义化策略均不能良好提取。MVP 的策略必然有盲区。

**设计目标**：让大模型在**首次访问某域名**时，基于页面样本自动推导出一份**可复用的提取配置**，此后该域名的文章提取完全零 LLM 成本。

### 核心原则

- ✅ **LLM 生成 DSL（JSON 配置），不生成 JS 代码**
- ❌ **严禁 `eval` / `new Function` / 动态 `import`**
- ✅ DSL 只能调用**白名单工具**（由我们预写的 DSL 解释器执行）
- ✅ 类比 Next.js / Vite 的 config 方案：LLM 产出"配置"，解释器在可信环境执行

### 架构预留点

在 MVP 中已留好的扩展接缝：

| 文件 | 预留内容 |
| --- | --- |
| `packages/tools/src/registry.ts` | 通用 Registry，按 priority 降序查询；新识别器注册 priority=100+ 即可覆盖内置 |
| `packages/tools/src/page/identity/index.ts` | `identityRegistry.register(...)` 入口 |
| `packages/tools/src/page/content/index.ts` | `contentRegistry.register(...)` 入口 |
| `packages/tools/src/page/types.ts` | `IdentityStrategy` / `ContentExtractor` 接口，已含 `priority` 字段 |

**对应单测**：`packages/tools/src/__tests__/pipeline.test.ts` 的 "支持注入更高优先级策略覆盖内置" / "支持注入自定义 extractor" 两个用例就是 Phase 2-b 的**提前演练**，实现时应继续通过这两个 test。

### DSL Schema 草案

```ts
interface DomainExtractorScript {
  version: 1;                     // 未来升级的兼容 key
  domain: string;                 // e.g. "docs.qq.com"
  urlPattern?: string;            // 可选正则；不同子路径用不同脚本
  createdAt: number;
  lastValidatedAt: number;

  identity: {
    idFrom: IdentitySource[];     // 顺序尝试
    titleFrom: IdentitySource[];
  };

  content: {
    root: Selector;               // 主体节点选择器
    exclude: Selector[];          // 排除噪音节点
    titleSelector?: Selector;
    format: 'text' | 'markdown';  // MVP 只支持 text
  };
}

type IdentitySource =
  | { type: 'urlParam'; key: string }
  | { type: 'urlPath'; regex: string; group?: number }
  | { type: 'selector'; css: string; attr?: string }
  | { type: 'metaProperty'; name: string }
  | { type: 'jsonLdField'; jsonPath: string };

type Selector = string; // CSS 选择器白名单（由解释器 sanitize）
```

### DSL 解释器约束（硬性）

实现 `DomainDslExtractor` 时必须遵守：

1. **CSS 选择器 sanitize**：禁止 `:has()` 以外的 CSS4 伪类中可能触发大量计算的用法；禁止包含 `<script>` / `<style>` 的选择器；用白名单校验。
2. **不访问 `document.cookie` / `localStorage` / `fetch`**：DSL 工具集仅提供 DOM 查询与文本处理。
3. **不修改页面 DOM**：只读，`document.cloneNode(true)` 后再操作。
4. **执行时间上限**：单次提取 500ms 超时自动降级到内置 pipeline。

### 触发与缓存策略

- **按需触发**：用户首次对该域名的文章使用对话功能时才生成
- **样本压缩**：向 LLM 发送的页面样本必须先做"DOM outline"
  - 保留标签层级 + 关键属性（`id`、`class`、`role`、`itemprop`）
  - 每个 text node 截断到 80 字符
  - 剪掉 `<script>` / `<style>` / SVG / base64 图片
  - 目标：< 10K tokens
- **缓存粒度**：`domain + urlPattern` 组合；同域名可存多条脚本

### 降级与失效检测

- 每次执行后校验结果：title 非空、content 长度 ≥ 120 字、文字占比 ≥ 40%
- 失败标记 `stale=true`，下次访问该域名重新生成
- 用户可在对话框菜单手动"重新识别此站点"（对应新增命令 `/relearn-site`）

### 禁止事项（红线）

- ❌ 不得引入动态 `eval` / `new Function` / `script.textContent = ...` 等代码注入方式
- ❌ 不得给 DSL 提供任何网络访问工具
- ❌ 不得绕过本文件的白名单校验
- ❌ ESLint 的 `no-eval` 规则必须对新增代码持续通过

### 相关代码锚点

- `packages/tools/src/page/types.ts:10`
- `packages/tools/src/page/identity/index.ts:5`
- `packages/tools/src/page/content/index.ts:4`
- `packages/tools/src/page/pipeline.ts:8`
- `packages/tools/src/registry.ts:5`

---

## §2 · Phase 2-a / 2-c：记忆层落地

### 设计目标

> "所有对话/上下文作为一种可检索的记忆资源，由用户通过自然语言召回。"

不提供传统的"会话列表 UI"，用户通过自然语言（"我上次看 MDN 时记录了什么？"）让 Agent 调用 `recall_memory` tool 召回。

### 接口已定义位置

- `packages/memory/src/interface.ts`：`MemoryStore` / `MemoryRecord` / `RecallQuery`
- `packages/memory/src/null-store.ts`：MVP 注入的空实现，Phase 2 仅替换为 `DexieMemoryStore` 即可，**Agent 代码零改动**。

### 实现范围

#### Phase 2-a（v0.2）·无向量的 Dexie 存储

- 依赖：新增 `dexie`（解除 ESLint 约束：`.eslintrc.cjs` 的 memory overrides）
- Schema：
  ```ts
  db.version(1).stores({
    records: '++pk, id, type, articleId, domain, url, timestamp, sessionId',
    sessions: '++pk, sessionId, articleId, domain, startedAt, endedAt'
  });
  ```
- `remember()`：写入 `MemoryRecord`；自动维护 `sessions` 表
- `recall()`：按 `timeRange / domain / articleId / topic` 过滤；`semantic` 退化为**关键词 LIKE**
- 自动清理：超过存储配额（navigator.storage.estimate()）的 80% 时删除最旧 `message` 类型记录

#### Phase 2-c（v0.4）·向量化 + 语义召回

- 新增 Provider：`EmbeddingProvider` 接口 + `QwenEmbeddingProvider` 实现（千问 `text-embedding-v2`）
- `MemoryRecord.embedding: Float32Array` 在 remember 时异步填充
- `recall()` 的 `semantic` 走余弦相似度（MVP 数据量不大，JS 内存里扫）
- 新增 LLM Tool：`recall_memory`（在 `packages/tools/src/definitions/` 新增）

### ContextSource 追加

MVP 已设计好扩展接缝（`packages/agent/src/context/source.ts`、`index.ts`）：

- **LongTermMemorySource**（priority 40）：从 Memory 查询 `type='fact'` 的长期记录（如"用户偏好 TypeScript"）
- **RelevantMemorySource**（priority 30）：按 `ctx.userInput` 语义查询相关历史片段
- **SessionSummarySource**（priority 20）：当前会话过长时提供压缩摘要

Phase 2-c 实现后，在 `buildDefaultMVPSources` → `buildDefaultPhase2Sources` 追加这三个即可，其它代码零改动。

### 数据模型（完整）

```ts
interface MemoryRecord {
  id: string;
  type: 'message' | 'summary' | 'fact' | 'reference';
  content: string;
  embedding?: Float32Array;
  timestamp: number;

  articleId?: string;
  domain?: string;
  url?: string;
  topic?: string[];
  sessionId?: string;

  parentId?: string;
  references?: string[];
  meta?: Record<string, unknown>;
}
```

### `/new` 命令语义保持不变

- `/new` 永远只清 UI 当前窗口的消息与即将发给 LLM 的 history
- **绝不影响记忆层**；新增 `/forget` 命令用于真正从记忆层删除

### 禁止事项

- ❌ **API Key 不得写入 IndexedDB**（仅 chrome.storage.local）
- ❌ 记录中不得存储用户的完整 apiKey / cookie / 登录态
- ❌ 向量维度与 embedding 模型必须绑定；更换模型要写迁移

### 相关代码锚点

- `packages/memory/src/interface.ts:7, 21, 42`
- `packages/memory/src/null-store.ts:7`
- `packages/memory/src/index.ts:7`
- `packages/agent/src/context/source.ts:8`
- `packages/agent/src/context/index.ts:33`
- `packages/agent/src/context/chat-history.ts:7`
- `packages/ui/src/commands/registry.ts:4, 40`
- `packages/ui/src/commands/types.ts:5`
- `packages/ui/src/commands/new-command.ts:5`
- `packages/ui/src/components/MessageBubble.tsx:7`
- `packages/tools/src/definitions/index.ts:4`

---

## §3 · Phase 3-a：OCR 与多模态

### 设计目标

让助手能处理 Canvas 渲染的内容（数学公式、图表、扫描 PDF 文本）。

### 策略模式（接口已定义）

`packages/tools/src/ocr/interface.ts`：`OCRStrategy` 骨架

```ts
interface OCRStrategy {
  readonly name: string;
  readonly priority: number;
  recognize(input: OCRInput): Promise<OCRResult>;
}
```

### 预期实现

1. **TesseractOCRStrategy**（轻量本地，第一步）
   - 依赖 `tesseract.js`（解除 ESLint 的 tools overrides 约束）
   - Web Worker 异步处理，避免阻塞主线程
   - 支持 `chi_sim` / `eng`
2. **MultimodalLLMOCRStrategy**（第二步）
   - 直接调用千问多模态模型（`qwen-vl-plus`），传图片 base64
   - 对数学公式转 LaTeX 效果更好
3. **兜底**：若策略均失败，返回 `{ text: '', confidence: 0 }` 而非抛错

### 新增 LLM Tool

- `capture_canvas`：遍历页面 `<canvas>`（含 `display:none`/`visibility:hidden`），调 `canvas.toDataURL()`
- `capture_region`：用户框选后截取区域（`chrome.tabs.captureVisibleTab` + 裁剪）
- `recognize_text`：对图片 data URL 调度 OCR 策略链

### 合规性

- 识别前必须**显式告知用户识图用途**；在设置页增加开关
- 禁止自动识别验证码、身份证等隐私敏感内容（URL 匹配黑名单）

### 禁止事项

- ❌ 未经用户确认，不得自动对整页做 OCR
- ❌ 不得把 OCR 结果写入记忆层的 `fact` 类型（防止隐私泄漏）

### 相关代码锚点

- `packages/tools/src/ocr/interface.ts:4, 26, 30`
- `packages/tools/src/index.ts:39`
- `packages/tools/src/definitions/index.ts:5`

---

## §4 · Phase 3-b：CheckerAgent 与实时提醒

### 设计目标

用户阅读到某段内容时，CheckerAgent 基于上下文检测**与历史记忆的关联点、潜在错误信息**，主动推送小提示（不打断阅读）。

### 触发机制（用户 27 号需求确认的方案）

- **用户手动激活**：设置页或 sidebar 菜单开启"实时提醒"开关
- **激活后监听**：对页面主体文本元素使用 `IntersectionObserver` 监听
- **已读标记**：元素首次显示即 `Map<elementId, true>` 标记，并 `unobserve`（不再重复监听）
- **新增内容监听**：对动态加载的 DOM 使用 `MutationObserver`
- **防抖提交**：
  - 新增文本量达到 ≥ 200 字符 **或**
  - 距上次提交超过 3s
  - 满足任一即触发 CheckerAgent

### Agent 架构

- CheckerAgent 继承 `Agent` 基类（`packages/agent/src/agent.ts`）
- 通过 `AgentOrchestrator.register(checkerAgent)` 注册（`packages/agent/src/orchestrator.ts:5`）
- 独立的 `ContextSource` 组合：
  - SystemPromptSource（Checker 专属提示词："你是背景校验助手…"）
  - PageContextSource（仅新增的文本段，不含历史）
  - RelevantMemorySource（从记忆层召回可能相关的历史）
  - **不使用** ChatHistorySource（Checker 是旁路检查，不涉及对话流）
- 输出直接走一条**旁路流**（UI 上用 Toast/右上角轻提示，不进主消息流）

### Orchestrator 扩展

- `AgentOrchestrator` 增加 `routeProactive(event): Agent` 方法
- 主对话 Agent 看到 Checker 的推送可以"引用"其结论

### UI 改动

- sidebar 新增 "监听" toggle + 激活态小红点
- 新增 `ProactiveNotificationToast` 组件（右上角卡片，3s 自动消失，可 pin）

### 禁止事项

- ❌ 默认**不开启**实时提醒；必须用户显式激活
- ❌ 监听范围仅限页面正文，**不得监听输入框**内容
- ❌ 单次 Checker 调用上下文 ≤ 2000 字符，防止 token 失控

### 相关代码锚点

- `packages/agent/src/agents/chat-agent.ts:6`
- `packages/agent/src/orchestrator.ts:5, 40`

---

## §5 · Phase 4：云端同步（可选）

### 设计目标

跨设备同步记忆层数据。用户主动点按钮同步，不做自动后台同步。

### 实现方案

- 在配置页新增"云同步"区块：提供自定义 endpoint（用户自托管）
- 同步协议走简单的 POST `/sync` JSON
- **端到端加密（E2EE）**：使用用户本地生成的密钥加密 `MemoryRecord` 后再上传
- 冲突策略：以 `timestamp` 为准，LWW（Last-Write-Wins）

### 禁止事项

- ❌ 不得内置默认云端地址（防止用户误以为"数据被传到我们服务器"）
- ❌ 同步协议中 apiKey 字段必须为空（云端也不应持有）

---

## §6 · 本期明确不做的功能清单（快速参考）

- [ ] 域名级 DSL 自学习提取（§1）
- [ ] 记忆层 Dexie 实现（§2）
- [ ] 向量化 / `recall_memory` tool（§2）
- [ ] OCR / 多模态识图（§3）
- [ ] 截图工具（§3）
- [ ] CheckerAgent / 实时提醒（§4）
- [ ] 云端同步（§5）
- [ ] 完整 Markdown 渲染（表格/latex/mermaid）
- [ ] Agent loop maxTurns 耗尽时兜底处理（最后一轮 LLM 仍返回 tool_calls 时，tool 执行结果被浪费、用户无任何提示，需在最后一轮强制不传 tools 或追加一轮无 tool 的兜底总结）→ `packages/agent/src/loop.ts`
- [ ] Token 级别的上下文截断（当前按字符粗略估算）
- [ ] 会话导出/导入
- [ ] 权限使用日志审计页

---

## §7 · 给下次 AI 协作者的指令

> 请在开始任何新的开发任务前，按顺序执行以下步骤：

1. **通读本文件**（`docs/ROADMAP.md`）
2. **阅读根 `README.md`** 了解项目结构与架构红线
3. **运行 `pnpm install` → `pnpm build` → `pnpm test`** 验证 MVP 正常工作
4. **查看 `.eslintrc.cjs`** 了解 3 条硬性架构红线：
   - Agent 层禁止 `import 'ai'` / `@ai-sdk/*`
   - Memory 层 MVP 禁止 `dexie`（Phase 2 实现时才解禁）
   - Tools 层 MVP 禁止 `tesseract.js`（Phase 3 实现时才解禁）
5. **使用 grep 搜索 `PHASE2:` / `PHASE3:` / `PHASE4:` 锚点**，理解对应扩展位
6. 任何偏离本文件描述的实现（包括"我觉得更好的架构"）**必须先征得用户同意**，不得擅自改动

### 特别强调

- 记忆层接口（`MemoryStore.remember/recall`）是契约；Phase 2 实现时不得修改接口签名，只能新增可选参数
- `ContextSource` 的 `priority` 数字范围：System=100 / Page=80 / Reference=70 / LongTermMemory=40 / RelevantMemory=30 / SessionSummary=20 / ChatHistory=10；新 Source 请勿占用这些数字
- Tool 的 `parametersJsonSchema` 必须是合法 JSON Schema，且 `execute` 必须抛出异常或返回 `{ok:false, error}` 标准化失败（参考 `packages/tools/src/definitions/read-page-content.ts`）
- 所有 commit 使用**中文 commit message** + Conventional Commits 前缀（`feat/fix/chore/docs/test`）

---

## 附录 A · MVP 已实现能力速查

| 模块 | 核心文件 | 说明 |
| --- | --- | --- |
| Provider | `packages/provider/src/qwen/index.ts` | QwenProvider，内部用 AI SDK 做协议适配，支持 enable_thinking |
| Agent | `packages/agent/src/agent.ts` / `loop.ts` | Agent 基类 + tool-calling loop（maxTurns 5） |
| ContextSource | `packages/agent/src/context/` | 4 个 MVP Source（System/Page/Reference/ChatHistory） |
| Tools | `packages/tools/src/page/` | 5 Identity + 4 Content 提取器 + 3 LLM Tool |
| UI | `packages/ui/src/features/chat/ChatPanel.tsx` | 侧边对话框 + Lexical + 斜杠命令 + 划词引用 |
| 配置页 | `packages/ui/src/features/options/OptionsForm.tsx` | antd 表单 + zod 校验 + 测试连接 |
| 扩展壳 | `apps/extension/` | MV3 manifest + Shadow DOM 注入 + options_ui |

## 附录 B · 测试速查

- 根目录 `pnpm test` 跑全部 44 个单测
- Provider normalizer：18 个（`packages/provider/src/__tests__/normalizer.test.ts`）
- Agent loop：5 个（`packages/agent/src/__tests__/loop.test.ts`）
- Tools pipeline：21 个（`packages/tools/src/__tests__/`，含 3 份 HTML fixture）
