# Doc Assistant · 后续迭代规划（ROADMAP）

> **本文件记录对外发布能力的版本规划，以及每个大阶段的设计原则、架构预留点、实现约束与禁止事项。**
>
> 后续迭代（包括 AI 协作开发）**必须先阅读本文件**以保持架构一致性。
>
> 文件内 `§1/§2/§3/§4` 标号与代码内 `// PHASE2:` / `// PHASE3:` 注释锚点一一对应。

---

## 版本路线

| 版本 | 主题 | 状态 |
| --- | --- | --- |
| **v0.1（MVP）** | 页面内文本对话 · Provider/Agent/Tools/UI 四层架构 · 侧边对话框 · 独立配置页 · 划词引用 · 斜杠命令 | ✅ 已发布（2026-04-17） |
| **v0.1.1** | Sidebar 真实页面可用性修复（Shadow DOM / finish 语义 / CORS / modulePreload 等 7 条踩坑） | ✅ 已发布（2026-04-18） |
| **v0.2.0 · Phase2 基础设施** | 三套 Provider + DexieMemoryStore + 四层记忆 Schema + PageVisit + Agent Loop 兜底 + 配置页 Tab 分页 | 🚧 开发中 |
| **v0.2.1 · Phase2 高级能力** | 辅助 LLM（主题识别/Intent/反思）+ 反思 Job + 召回机制 + `/recall` `/topic` + WorkingMemory tools + Persona 审核 UI | 规划中 |
| **v0.3（Phase2-b）** | 域名级 DSL 自学习文章提取器（见 §1） | 规划中 |
| **v0.4（Phase3-a）** | OCR 策略 · 截图工具（见 §3） | 规划中 |
| **v0.5（Phase3-b）** | CheckerAgent · 实时提醒（见 §4） | 规划中 |
| **v0.6（Phase4）** | 云端同步（选配，E2EE）（见 §5） | 规划中 |

---

## §2 · Phase 2：记忆层（类人脑分层工作机制）· v0.2 定稿方案

> **核心理念**：记忆层的本质是"每一轮组装合适的上下文给 LLM"，而不是"把聊天窗口原样丢过去"。
> 用户原话：如果把 LLM 当作一个人，那么它应该是从过去的对话中**记住一些东西**而不是直接把聊天窗口丢给 LLM。

### 四层记忆（定稿）

| 层 | 用途 | 生命周期 | 注入策略 | 写入主体 |
| --- | --- | --- | --- | --- |
| **Persona（个性）** | 关于用户的稳定事实 / 偏好，如"偏好 TypeScript"、"喜欢源码级解释" | 永久 | Top-10 常驻 system prompt（仅 reviewedByUser=true） | 辅 LLM 异步反思 + 主 LLM `remember_persona` tool |
| **Episodic（事件）** | 对话/阅读的长期历史，两级粒度：`episodes_msg`（消息原文） + `episodes_visit_summary`（visit 摘要 + embedding） | 永久 | **默认不注入，按需召回** | 代码同步写 msg 级；辅 LLM 异步写 summary 级 |
| **SessionTopic（情景）** | 当前 PageVisit 的领域焦点（类似 system prompt 角色指令），用于约束 LLM 注意力；对用户透明 | PageVisit 级 | 常驻一行 | 辅 LLM 每 3-5 轮识别 |
| **WorkingMemory（工作）** | 按 canonicalUrl 绑定的 TodoList + ActiveGoal，让 Agent 知道"正在做什么" | 30 天 LRU 软 TTL | 常驻列表 | 主 LLM 通过 7 个细粒度 tool |

### PageVisit 替代 session 概念

- **PageVisit** = 一次 tab 开→关的物理 UI 边界
- 切换 canonicalUrl 或 `/new` 命令 = 新 PageVisit
- 对话连续性**不靠 session 实体**，靠记忆召回自动恢复（用户类比："人第二天依然可以接着前一天的工作来"）
- `PageVisitManager`（`packages/agent/src/page-visit/`）负责生命周期

### URL 归一化

- 优先 `<link rel="canonical">` / `og:url` / `twitter:url`
- 回退：原始 URL 剥离 UTM 家族 / fbclid / gclid → 去 hash → 去结尾斜杠
- 实现：`packages/shared/src/url-normalize.ts`

### 召回策略

- **默认常驻注入**：Persona / SessionTopic / WorkingMemory / ChatHistory / Page / Reference
- **按需召回**（RelevantMemorySource priority=40）：
  - 代码关键词粗匹配（"上次 / 之前 / 前几天 / 还记得 / 我们聊过 / 昨天 / ..."）
  - 命中后**辅 LLM intent 二次确认**防止假阳性
  - 确认后走 embedding 向量召回 Top-K
- **主 LLM 主动路径**：`recall_memory` tool
- **用户显式路径**：`/recall <query>` 命令

### 三套 Provider 配置

- `main`：主对话（必填，v0.1 → v0.2 自动迁移旧 QWEN_CONFIG）
- `auxiliary`：话题识别 / 反思 / Intent 精判（默认复用主，可单独配 qwen-turbo 省钱）
- `embedding`：visit_summary 向量化 + query 向量化（默认复用主的 baseURL+apiKey，model 单独填 v2/v3）
- 所有 Provider 统一 `baseUrl + model + apiKey` 规范，可接入本地或云端

### 敏感信息过滤

- 默认**开启**（用户可关）
- 模式：email / 手机号 / 身份证 / apiKey（sk-/ghp_/AKID/JWT 等）/ 信用卡号
- 处理：写入 IDB 前替换为 `[REDACTED:type]`；LLM 上下文也是占位符
- 实现：`packages/shared/src/sensitive-filter.ts`

### 反思 Job（可靠性设计）

- **同步必做**（v0.2.3 落地 ✅）：每条消息到达立即同步写 `episodes_msg`（见 `useStreamingChat.persistMessage` + `sidebar/index.tsx` 装配点）；`working_memories.touchLastAccessed` 由 `get_working_memory` tool 路径触发
- **异步补跑**：PageVisit 结束时登记 `reflection_tasks`，当场尝试执行（失败无妨）
- **补跑时机**：下次 sidebar 打开扫 pending + `chrome.alarms` 每 60 分钟扫描
- **容错**：失败重试 3 次 → 标记 failed 不再重试
- 关键：原始消息**绝对落盘**，反思失败只影响 summary/persona 生成

### Persona 审核交互

- **配置页 Tab**：完整审核列表（批量接受/拒绝/编辑）
- **sidebar 折叠条**：参考 codebuddy 文件变更确认条样式
  - 折叠态：`> N 条新的个性记忆待审核 [接受全部][忽略][去配置页]`
  - 展开态：逐条显示 content / 来源 / 置信度 / [✓接受][✗拒绝][编辑]
- **丢弃语义**：tab 关闭即丢 UI 提醒，数据保留在 IDB，用户随时可去配置页批量审核
- **不重复打扰**：已浮现过的 candidate 不再主动浮（b 选项）

### 命令语义

| 命令 | 语义 |
| --- | --- |
| `/new` | 重启 = 清 UI + 清 history + 新 visitId；**不清** WorkingMemory / Persona / Episodic |
| `/topic` | 强制辅 LLM 重识别主题（高级用户） |
| `/topic <文本>` | 手动设置领域焦点（高级用户） |
| `/recall <query>` | 显式语义召回 Episodic |
| `/forget` | 本期不做（延后） |

### 分工原则

- **纯确定性任务 → 代码**（消息写入、URL 归一化、敏感过滤、关键词粗匹配、TTL 清理、WorkingMemory 读写）
- **代码能做但语义易错 → 代码粗判 + 辅 LLM 精判**（召回 intent）
- **必须语义理解 → 辅 LLM**（SessionTopic 识别、visit summary、Persona 抽取、冲突检测）
- **主 LLM 只做主对话 + 必要时调 tool**，不承担副任务

### ContextSource priority 约定（严格遵循）

| priority | Source | 说明 |
| --- | --- | --- |
| 100 | SystemPromptSource | MVP |
| 80 | PageContextSource | MVP |
| 70 | ReferenceTagSource | MVP |
| 60 | PersonaSource | **v0.2.0** |
| 55 | SessionTopicSource | **v0.2.0** |
| 50 | WorkingMemorySource | **v0.2.0** |
| 40 | RelevantMemorySource | **v0.2.1** |
| 20 | SessionSummarySource | 预留（本期不做） |
| 10 | ChatHistorySource | MVP |

### v0.2.0（基础设施）已完成 / 进行中

- [x] `@doc-assistant/shared`：三套 Provider 配置 + MemorySettings + url-normalize + sensitive-filter + clampMaxTurns
- [x] `@doc-assistant/provider`：EmbeddingProvider 接口 + QwenEmbeddingProvider
- [x] `@doc-assistant/agent`：Loop 最后一轮兜底（纯 A）+ PageVisitManager + Phase2 ContextSource（Persona/SessionTopic/WorkingMemory）
- [x] `@doc-assistant/memory`：DexieMemoryStore（6 张表 + 向量余弦 + LRU + 敏感过滤）+ NullMemoryStore no-op 兼容
- [x] 配置页 Tab 分页（基础 / 记忆 / 高级 / 调试）+ ProviderConfigForm 复用组件
- [x] Sidebar bootstrap 装配三套 Provider + DexieMemoryStore + PageVisitManager
- [x] Service Worker 注册 `reflection-scan` alarm（占位，v0.2.1 填充执行器）
- [x] v0.1 → v0.2 配置迁移（bootstrap 自动迁移，用户无感升级）

### v0.2.1（高级能力）已完成

- [x] 辅助 LLM 调用链（`collectText` / `callAuxIntent` / `identifySessionTopic` / `shouldIdentify`，失败全部降级）
- [x] ReflectionRunner（visit_summary / persona_extraction / conflict_check 占位）+ ReflectionScheduler（串行 + 重试上限 + SW alarm 广播）
- [x] RelevantMemorySource（priority=40，粗判→aux→向量→邻居拼接）+ buildDefaultPhase2_1Sources
- [x] `recall_memory` / `remember_persona` tool + WorkingMemory 7 个细粒度 tool + buildPhase2Tools 动态注册
- [x] `/recall <query>` / `/topic [<text>]` 命令 + `/new` 语义重构（清 UI + 新 visitId，不清记忆）
- [x] PersonaReviewBanner（sidebar 折叠条 + 接受/拒绝 + 跳转配置页）+ WorkingMemoryCard（TODO 进度 + 5s 轮询）
- [x] ChatPanel 通过可选 props 接入全部能力；保持 MVP 路径向后兼容

### v0.2.2（已完成）· Persona 语义转向

- [x] Persona 重定位为"Agent 长期指令"（数据 schema 零变更）：tool description、PersonaSource 注入段、反思 Job prompt、PersonaReviewBanner / MemoryTab 文案同步升级
- [x] `PersonaRecord.content` 注释示例更新；测试断言同步新语义

### v0.2.3（已完成）· 修漏 + 精化 Prompt · "真正能工作的记忆"

- [x] 消息持久化：`useStreamingChat.persistMessage` port + sidebar 装配，兑现 ROADMAP §79 的"同步必做"
- [x] 刷新三段式 rehydrate：WorkingMemory → 跨 visit 近 5 轮 episodes_msg → 向量召回（按 canonicalUrl 拉，不分 visitId）
- [x] 主 system prompt 升级为"工作方式多段守则"：真正的助手人设、不把状态贴脸上、主动维护 WorkingMemory、自然接续上次
- [x] tool description 全面精化：WorkingMemory / remember_persona / recall_memory 全部写明"主动触发时机"；参数 description 补全
- [x] initialHistoryForLLM 只喂 LLM 不进 UI（"像真正的助手一样"哲学）

### v0.2.3+（未来方向，未排期）

#### 记忆层完善
- [ ] `persona_conflict_check` 实装（检测长期指令矛盾并合并/裁决）
- [ ] PersonaReviewList：配置页长期指令 Tab 的批量审核视图（支持编辑）
- [ ] `/forget` 命令：主动从记忆层删除
- [ ] 会话导入 / 导出（JSON）
- [ ] **跨 visit 时间维记忆检索 · Chronological Index**（用户反馈 2026-04-24）
  - 动机：当前 `recall_memory` 基于语义向量，无法处理"今天看了哪些文章"、"本周读了什么"这类**元查询**——embedding 基于内容编码，时间维根本不在语义空间里。用户在新域名下问这类问题会拿到"未找到"，体验差。
  - v0.2.3 的小修补：`recall_memory` 已能识别这类时间维元查询并返回 `reason='time_query_unsupported'` 的明确提示（避免假阴性），主 LLM 坦诚告诉用户"这类查询暂不支持"。完整方案见下。
  - 目标设计：
    - **新 tool · `list_recent_visits`**：按时间窗口列 visit_summary（参数：`timeRange`（today/yesterday/this-week/custom-start-end）、可选 `domain` 过滤、`limit`）。返回结构化的"visit 清单"——每条含 URL / title / summary / timestamp / domain。
    - **扩展 `recall_memory`**：接受可选 `timeRange` / `domain` / `articleId` 参数。当前底层 `DexieMemoryStore.recall` 已支持这些过滤（v0.2 就写好了，只是 tool 层没暴露）。
    - **主 system prompt 提示**：加一条"对'今天/本周看了什么'这类时间维元查询用 `list_recent_visits`，而非 `recall_memory`"的行为守则。
    - **自动路由（可选）**：`RelevantMemorySource` 在识别到时间维查询时，跳过向量召回，直接调用 `list_recent_visits`——让用户感知不到 tool 边界。
  - 产品哲学：这是"**助手在某项特定工作 / session 之外的记忆**"——不被 canonicalUrl / visitId 限制，类似人类的"时序自传式记忆"。
- [ ] **记忆浏览器 Tab**（配套上一条）
  - 配置页新增"记忆浏览器" Tab，让用户**自己**能按时间/域名浏览自己沉淀的 visit_summary（类似浏览历史，但含 AI 归纳的摘要）。
  - 视图：按日期分组 → 每组内按域名聚合 → 点开看 summary + tags。支持"删除单条"、"导出"。
  - 价值：
    1. 让"记忆系统"对用户**可见可审**（目前记忆都在 IDB 里黑盒）
    2. 配合 `/forget` 命令（未排期那一条）做可视化删除
    3. 用户信任的基础：能看到 AI 记了什么、能改/能删

#### UI / 可观测性
- [ ] UI 层 tool-call 可观测性：assistant 消息加"已调用 N 个工具"徽章，点击展开参数/结果（源于 TROUBLESHOOTING §10 启示）
- [ ] RecallResultCard 独立样式（目前复用 `appendAssistantNote` 以 assistant 消息形式展示）
- [ ] **Token 用量看板**（用户反馈，优先级偏高）
  - 目标：直观看到"今天主/辅 LLM 各花了多少 token"，为调参/换模型提供依据
  - 数据采集：
    - 在 `QwenProvider.chat` / `QwenEmbeddingProvider.embed` 的 stream `finish` / 响应处拿 `usage.promptTokens / completionTokens / reasoningTokens`
    - 按 `provider-kind × model-id × 日期`（UTC+8）聚合，写入新表 `token_usage`（Dexie 新表，schema 升级）
    - 需要区分**主 / 辅 / embedding 三路**（靠 Provider 实例的"角色"标签区分——bootstrap 装配时打标）
  - 展示：配置页新增"用量"Tab
    - 今日：主 / 辅 / embedding 各模型的 token 柱状图 + 总数
    - 最近 7 天趋势折线
    - 各模型的累计（便于估算成本，若用户填了单价可展示金额）
  - 注意：
    - 反思 Job 也会调 aux / embedding，记得打"reflection"来源标签便于追溯哪类调用最耗
    - 数据只在本地 IDB，不上传；清理策略：保留 90 天，每次启动时清理过期
    - 千问 usage 字段在 AI SDK stream 的 `finish` part 里，`normalizer.ts` 已归一化为 `ChatChunk.usage`，可直接消费

#### 代码清理
- [ ] **移除 v0.1 向后兼容代码**（用户反馈，适合在稳定一版后做）
  - 项目尚未正式发布，旧版本（v0.1）的兼容代码属于无用包袱，集中清理避免混乱
  - 清理清单（初步）：
    - `packages/shared/src/config.ts` · `STORAGE_KEYS.QWEN_CONFIG` 与 `QwenProviderConfig` 旧字段（v0.2 已迁移到 MAIN_PROVIDER_CONFIG）
    - `apps/extension/src/sidebar/bootstrap.ts` · 旧 `QWEN_CONFIG` 自动迁移逻辑
    - `packages/memory/src/interface.ts` · `MemoryRecord.sessionId`（v0.1 兼容字段，已被 `visitId` 取代）
    - `packages/memory/src/interface.ts` · `MemoryRecordType` 里的 `'summary' | 'fact' | 'reference'`（v0.1 占位，v0.2 后未被任何代码写入）
    - ChatSettings.systemPrompt 的"用户可改"逻辑如仍存在旧存储 key，一并清
  - 风险：清理前先扫全仓确认无读写引用；IndexedDB 老数据（若有）需要明确是否允许丢弃

### 架构红线（ESLint 强约束）

- Agent 层禁止 `import 'ai'` / `@ai-sdk/*`（通过 LLMProvider / EmbeddingProvider 接口访问）
- **v0.2 起**：Memory 层**解除** dexie 约束（Phase2 已落地）
- Tools 层仍禁止 `tesseract.js`（Phase3-a 才解禁）
- ESLint `no-eval` 持续通过
- `MemoryStore.remember / recall` 签名不得修改；新增方法一律**可选**；NullMemoryStore 提供 no-op 兜底
- ContextSource priority 按上表约定，新 Source 不得占用已有数字

### 禁止事项（红线）

- ❌ API Key 不得写入 IndexedDB（仅 `chrome.storage.local`）
- ❌ 记录中不得存储用户完整 apiKey / cookie / 登录态
- ❌ 向量维度与 embedding 模型必须绑定；更换模型要清库重建
- ❌ `/new` 不得清除 WorkingMemory / Persona / Episodic（语义是"重启对话线"而非"擦除记忆"）
- ❌ SessionTopic / 反思 Job 不得污染主 LLM 请求（辅 LLM 独立调用）

### 相关代码锚点

- `packages/memory/src/interface.ts` · MemoryStore 契约 + 所有类型
- `packages/memory/src/db/` · DexieMemoryStore / vector / schema
- `packages/agent/src/context/{persona,session-topic,working-memory}.ts` · 三个新 Source
- `packages/agent/src/page-visit/` · PageVisit 生命周期
- `packages/agent/src/loop.ts` · Loop 兜底
- `packages/provider/src/qwen/embedding.ts` · QwenEmbeddingProvider
- `packages/shared/src/{url-normalize,sensitive-filter,config}.ts` · 核心工具
- `apps/extension/src/sidebar/bootstrap.ts` · 装配入口
- `apps/extension/src/background/index.ts` · SW alarms
- `packages/ui/src/features/options/` · 配置页 Tab

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

**对应单测**：`packages/tools/src/__tests__/pipeline.test.ts` 的 "支持注入更高优先级策略覆盖内置" / "支持注入自定义 extractor" 两个用例就是 Phase 2-b 的**提前演练**。

### DSL Schema 草案

```ts
interface DomainExtractorScript {
  version: 1;
  domain: string;
  urlPattern?: string;
  createdAt: number;
  lastValidatedAt: number;

  identity: {
    idFrom: IdentitySource[];
    titleFrom: IdentitySource[];
  };

  content: {
    root: Selector;
    exclude: Selector[];
    titleSelector?: Selector;
    format: 'text' | 'markdown';
  };
}

type IdentitySource =
  | { type: 'urlParam'; key: string }
  | { type: 'urlPath'; regex: string; group?: number }
  | { type: 'selector'; css: string; attr?: string }
  | { type: 'metaProperty'; name: string }
  | { type: 'jsonLdField'; jsonPath: string };

type Selector = string;
```

### DSL 解释器约束

1. **CSS 选择器 sanitize**（禁止 `<script>` / `<style>`，白名单校验）
2. **不访问 `document.cookie` / `localStorage` / `fetch`**
3. **不修改页面 DOM**（只读 + cloneNode）
4. **执行时间上限** 500ms 超时降级

### 禁止事项

- ❌ 不得引入 `eval` / `new Function` / `script.textContent = ...`
- ❌ 不得给 DSL 提供网络访问工具
- ❌ 不得绕过白名单

---

## §3 · Phase 3-a：OCR 与多模态

### 设计目标

让助手能处理 Canvas 渲染的内容（数学公式、图表、扫描 PDF 文本）。

### 策略模式（接口已定义）

`packages/tools/src/ocr/interface.ts` · `OCRStrategy` 骨架。

### 预期实现

1. **TesseractOCRStrategy**（第一步，解除 tools 的 `tesseract.js` ESLint 约束）
2. **MultimodalLLMOCRStrategy**（第二步，调千问 `qwen-vl-plus`）
3. **兜底**：所有策略失败返回 `{ text: '', confidence: 0 }` 不抛错

### 新增 LLM Tool

- `capture_canvas` · `capture_region` · `recognize_text`

### 合规性

- 识别前**显式告知用户**；配置页开关
- 禁止自动识别验证码 / 身份证等隐私敏感内容（URL 黑名单）

---

## §4 · Phase 3-b：CheckerAgent 与实时提醒

### 设计目标

用户阅读到某段内容时，CheckerAgent 基于上下文检测**与历史记忆的关联点、潜在错误信息**，主动推送小提示（不打断阅读）。

### 触发机制

- **用户手动激活**：设置页/sidebar 菜单开关
- **激活后**：对页面主体文本用 `IntersectionObserver`
- **已读标记** + **MutationObserver** 追踪新增 DOM
- **防抖提交**：新增文本量 ≥ 200 字符 **或** 距上次 > 3s

### Agent 架构

- CheckerAgent 继承 `Agent` 基类
- 通过 `AgentOrchestrator.register(checkerAgent)` 注册
- **独立 ContextSource**：SystemPrompt（Checker 专属）+ PageContext（仅新增段）+ RelevantMemory；**不使用** ChatHistory
- 输出走**旁路流**（Toast / 右上角轻提示，不进主消息流）

### 禁止事项

- ❌ 默认不开启
- ❌ 监听范围仅限页面正文，**不得监听输入框**
- ❌ 单次 Checker 调用上下文 ≤ 2000 字符

---

## §5 · Phase 4：云端同步（可选）

### 设计目标

跨设备同步记忆层数据。用户主动点按钮同步，不做自动后台同步。

### 实现方案

- 配置页"云同步"区块：自定义 endpoint（用户自托管）
- 同步协议：POST `/sync` JSON
- **端到端加密（E2EE）**：本地密钥加密 `MemoryRecord` 后上传
- 冲突策略：`timestamp` LWW

### 禁止事项

- ❌ 不得内置默认云端地址
- ❌ 同步协议中 apiKey 字段必须为空

---

## §6 · 本期（v0.2）明确延后的能力清单

v0.2 范围聚焦"记忆层 + Agent Loop 兜底"，以下项目**明确延后到下一期**（v0.3+ 或单独安排）：

- [ ] **完整 Markdown 渲染**（表格 / LaTeX / 代码高亮，不含 Mermaid）
- [ ] **日志审计页**（独立 Tab / 粒度 / JSON 导出）
- [ ] **流式响应过程可视化**（思考过程 / 工具调用 / skills 的时间线展示）
- [ ] **配置页首次安装引导流程**（antd Tour）
- [ ] **`/forget` 命令**（从记忆层真正删除特定条目）
- [ ] **会话导出 / 导入**（JSON）
- [ ] **权限使用日志审计**（与 #日志审计页 合并）
- [ ] **Token 级上下文截断**（替代字符估算）
- [ ] **Provider baseURL 自定义时的 `host_permissions` 动态申请**（v0.1.1 §4 遗留）
- [ ] **SPA 场景页面摘要过期**的主动刷新策略
- [ ] **流式响应中 tool 执行的可视化状态**（长 tool 执行时的"思考中/调用中"指示）
- [ ] **Provider 层抽象**以支持 OpenAI / Anthropic / Ollama 等（目前仅 Qwen）
- [ ] **WorkingMemory 归档到 Episodic**的具体内容格式（v0.2.1 填充时完善）
- [ ] **域名级 DSL 自学习提取器**（§1）
- [ ] **OCR / 多模态识图**（§3）
- [ ] **CheckerAgent / 实时提醒**（§4）
- [ ] **云端同步**（§5）
- [ ] **`chrome.alarms` reflection-scan 的真正执行器**（v0.2.1 实装）

---

## §7 · 给下次 AI 协作者的指令

> 请在开始任何新的开发任务前，按顺序执行以下步骤：

1. **通读本文件**（`docs/ROADMAP.md`）
2. **阅读根 `README.md`** 了解项目结构与架构红线
3. **阅读 `docs/TROUBLESHOOTING.md`** 了解已修复的"坑点"，避免回踩
4. **运行 `pnpm install` → `pnpm build` → `pnpm test`** 验证工程正常
5. **查看 `.eslintrc.cjs`** 了解架构红线：
   - Agent 层禁止 `import 'ai'` / `@ai-sdk/*`
   - Memory 层**v0.2 起解除** dexie 约束
   - Tools 层禁止 `tesseract.js`（Phase3-a 才解禁）
6. **使用 grep 搜索 `PHASE2:` / `PHASE3:` / `PHASE4:` 锚点**，理解对应扩展位
7. 任何偏离本文件描述的实现（包括"我觉得更好的架构"）**必须先征得用户同意**，不得擅自改动

### 特别强调

- 记忆层接口（`MemoryStore.remember/recall`）是**契约**；不得修改签名，只能新增可选参数/方法
- `ContextSource` 的 `priority` 数字范围：System=100 / Page=80 / Reference=70 / Persona=60 / SessionTopic=55 / WorkingMemory=50 / RelevantMemory=40 / SessionSummary=20 / ChatHistory=10；新 Source 请勿占用这些数字
- Tool 的 `parametersJsonSchema` 必须是合法 JSON Schema，且 `execute` 必须抛出异常或返回 `{ok:false, error}` 标准化失败
- 所有 commit 使用**中文 commit message** + Conventional Commits 前缀（`feat/fix/chore/docs/test`）

---

## 附录 A · v0.2.0 已实现能力速查

| 模块 | 核心文件 | 说明 |
| --- | --- | --- |
| Provider | `packages/provider/src/qwen/index.ts` + `embedding.ts` | QwenProvider（v0.1 稳定） + QwenEmbeddingProvider（v0.2 新增） |
| Agent Loop | `packages/agent/src/loop.ts` | tool-calling loop + 最后一轮纯 A 兜底（v0.2） |
| PageVisit | `packages/agent/src/page-visit/` | 生命周期管理，替代 session（v0.2 新增） |
| ContextSource | `packages/agent/src/context/` | 7 个 Source（v0.1 4 个 + v0.2.0 新增 3 个） |
| Memory | `packages/memory/src/db/` | DexieMemoryStore（v0.2 新增 6 张表） |
| URL / 过滤 | `packages/shared/src/url-normalize.ts` + `sensitive-filter.ts` | v0.2 新增 |
| 配置页 | `packages/ui/src/features/options/` | Tab 分页（v0.2 重构） |
| Sidebar | `apps/extension/src/sidebar/bootstrap.ts` + `index.tsx` | 装配三套 Provider + PageVisit（v0.2 重构） |
| Service Worker | `apps/extension/src/background/index.ts` | alarms 注册（v0.2 新增，v0.2.1 填充执行器） |

## 附录 B · 测试速查

- 根目录 `pnpm test` 跑全部单测
- v0.2.0 新增测试（~80 个）：
  - `packages/shared/src/__tests__/` · url-normalize / sensitive-filter / config（59 个）
  - `packages/provider/src/__tests__/embedding.test.ts` · QwenEmbeddingProvider（16 个）
  - `packages/memory/src/__tests__/` · vector / dexie-store（36 个）
  - `packages/agent/src/__tests__/page-visit.test.ts` · PageVisitManager（11 个）
  - `packages/agent/src/__tests__/phase2-sources.test.ts` · Persona / SessionTopic / WorkingMemory Source（18 个）
  - `packages/agent/src/__tests__/loop.test.ts` · 新增 3 个 v0.2 兜底用例（保留原 5 个）
