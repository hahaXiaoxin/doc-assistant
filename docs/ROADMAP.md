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
| **v0.2.0 · Phase2 基础设施** | 三套 Provider + DexieMemoryStore + 四层记忆 Schema + PageVisit + Agent Loop 兜底 + 配置页 Tab 分页 | ✅ 已发布 |
| **v0.2.1 · Phase2 高级能力** | 辅助 LLM（主题识别/Intent/反思）+ 反思 Job + 召回机制 + `/recall` `/topic` + WorkingMemory tools + Persona 审核 UI | ✅ 已发布 |
| **v0.3.0** | 移除 v0.1 兼容代码（Breaking Change） | ✅ 已发布 |
| **v0.4.0** | 可见且可按时间检索的记忆系统（Persona 双主体 / Chronological Index / 记忆浏览器 Tab / 话题漂移关键词触发 / host_permissions 放开） | ✅ 已发布 |
| **v0.5.0** | 统一记忆 · Offscreen Document 架构（所有域名共用一套 DB，§8 绕路删除，反思 Job 迁到 offscreen） | ✅ 已发布 |
| **v0.6.0-beta.2** | DeepSeek Provider 接入 + OpenAI 兼容基类轻量抽离 + Provider Registry（见 §6） | ✅ 已发布 |
| **v0.6（Phase2-b）** | 域名级 DSL 自学习文章提取器（见 §1） | 规划中[^manifest-0.6-beta]（待确认） |
| **v0.7（Phase3-a）** | OCR 策略 · 截图工具（见 §3） | 规划中 |
| **v0.8（Phase3-b）** | CheckerAgent · 实时提醒（见 §4；框架承接 [`backlog.md#B-002`](./backlog.md#b-002--自定义智能体领域专家)） | 规划中 |
| **v0.9（Phase4）** | 云端同步（选配，E2EE）（见 §5） | 规划中 |

[^manifest-0.6-beta]: 2026-05-06 归档登记矛盾：`apps/extension/manifest.json` 当前版本号为 `0.6.0-beta.1`，ROADMAP 显示 v0.6 仍在规划中、最近已发版是 v0.5.0；两处不一致，**需核实是发版抢号还是文档未同步** —— 留待 developer / 维护者确认。本次归档**不擅自改 manifest，也不擅自宣告 v0.6 发版**，只是登记矛盾。

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

- `main`：主对话（必填）
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

### v0.2.3（已完成，部分回退见 v0.2.5）· 修漏 + 精化 Prompt · "真正能工作的记忆"

- [x] 消息持久化：`useStreamingChat.persistMessage` port + sidebar 装配，兑现 ROADMAP §79 的"同步必做"
- [x] ~~刷新三段式 rehydrate：WorkingMemory → 跨 visit 近 5 轮 episodes_msg → 向量召回~~（**v0.2.5 回退**：预热机制违反"意图驱动"原则，跨 visit 消息无脑注入反而污染上下文。只保留 `persistMessage` 落库；真正的跨 visit 时间维查询由 ROADMAP · Chronological Index 专门承接）
- [x] 主 system prompt 升级为"工作方式多段守则"：真正的助手人设、不把状态贴脸上、主动维护 WorkingMemory、自然接续上次
- [x] tool description 全面精化：WorkingMemory / remember_persona / recall_memory 全部写明"主动触发时机"；参数 description 补全
- [x] initialHistoryForLLM port 保留在 useStreamingChat / ChatPanel（Chronological Index 落地时复用）

### v0.2.4（已完成）· 上下文分层机制可用化 + UI 两处 bug 修

- [x] `WorkingMemoryCard` 展开态空 bug：`activeGoal 非空 + todos 空`时展开只有 chevron 动画 → 补 GoalDetail / EmptyHint 兜底
- [x] 顶部页面上下文卡片只显"201字摘要"不显真内容 → 抽独立 `PageContextCard`，展开显真实摘要（500 字上限 + 滚动）；`full-body` 低可信 extractor 显式标注降级提示
- [x] `hashchange` 监听 + 清当前 topic（不切 visit，规避反思 Job 重操作）；下轮用户提问自动重新识别新文章话题
- [x] `SessionTopic` 自动触发：`useStreamingChat.onRoundFinished` 每轮抛信号 + sidebar 用 `shouldIdentify()` 判定后调 `identifySessionTopic`（之前只有 `/topic` 命令能手动触发）
- [x] 跨 visit 消息分组降级：`UIMessage` 加 `visitId`/`visitTitle` 标签；`groupMessagesByVisit` 组装 history 时按 visit 分组，非当前 visit 前置 system 段`# 之前在《上篇文章》中的对话（N 条）`+ 明确降权提示

### v0.2.5（已完成）· 刷新预热机制回退 · "意图驱动"的召回架构修正

- [x] 删除 `sidebar/index.tsx` 的 rehydrate useEffect——不再 mount 时无脑按 canonicalUrl 跨 visit 拉历史消息
- [x] 保留 `persistMessage` 落库（数据基础不变，仅撤回**注入**逻辑）
- [x] `initialHistoryForLLM` port 定义保留，供 Chronological Index 能力未来复用
- [x] 接受"刷新承接式失忆"的代价：刷新后"然后呢"这类承接输入需要用户补一句上下文；真机验证后如高频可加"30 分钟内同 visit"窄条件兜底

### v0.5.0（已完成）· 统一记忆 · Offscreen Document 架构

> 详细设计见 [`docs/requirements/v0.5.0-unified-memory.md`](./requirements/v0.5.0-unified-memory.md)；变更摘要见 [`CHANGELOG · v0.5.0`](./CHANGELOG.md#v050--统一记忆--offscreen-document-架构)。

- [x] **Origin 隔离修复 / cross-domain memory**：`DexieMemoryStore` 搬到 Offscreen Document（扩展 origin），所有域名共用同一份 IDB ✅ 已于 v0.5.0 完成
- [x] **反思 Job 真机验证 / 迁移到 offscreen**：`ReflectionRunner` / `ReflectionScheduler` 从 sidebar 搬到 offscreen，关闭 sidebar 也能继续跑 ✅ 已于 v0.5.0 完成
- [x] **§8 绕路删除**：`MessageType.REFLECTION_SCAN_TICK` 及其广播/监听链路彻底删除；改为 SW 转发 `REFLECTION_TICK` → offscreen 直接执行 ✅ 已于 v0.5.0 完成
- [x] **`RemoteMemoryStore` 消息代理**：sidebar / options 通过 `MEMORY_RPC_REQUEST` envelope 调用 22 条 MemoryStore 方法 ✅ 已于 v0.5.0 完成
- [x] **`minimum_chrome_version: 109`**：manifest 声明版本下限，避免低版本 Chrome 安装 crash ✅ 已于 v0.5.0 完成

### v0.2.5+（未来方向，未排期）

#### 记忆层完善
- [ ] 🚧 `persona_conflict_check` 实装（检测长期指令矛盾并合并/裁决）—— **骨架已落，完整逻辑待实装**[^pcc-skeleton]

[^pcc-skeleton]: 2026-05-06 归档勘误：代码 `packages/agent/src/reflection/runner.ts` 中已存在对应的 no-op 骨架分支（任务类型识别 + 占位返回），只是 prompt + 落库写入逻辑尚未实装；因此状态从 🔲 未实装 调整为 🚧 在建。
- [ ] PersonaReviewList：配置页长期指令 Tab 的批量审核视图（支持编辑）
- [ ] `/forget` 命令：主动从记忆层删除
- [ ] 会话导入 / 导出（JSON）
- [ ] **Persona 双主体重建 · Agent 自我设定 vs 用户画像区分**（用户反馈 2026-04-24 · 重开）
  - 背景：v0.2.2 曾把 Persona 统一为"Agent 长期指令"以消除歧义；真机跑一段后用户发现**两类记忆的混用还是会让模型糊涂**——
    - "用户是前端工程师"（关于用户的事实） vs "回答时默认用前端语境"（Agent 行为规则）
    - 虽然我们当时要求模型把前者转译成后者，但模型在不同 query 下两种形态都会产出，语义不清
  - 目标设计（轻量）：给 `PersonaRecord` 加 `subject: 'agent' | 'user'` 字段，同一张表两种视角：
    - `subject='agent'`：写给 Agent 自己的指令（当前全部属于此）
    - `subject='user'`：关于用户本人的事实，注入时话术为"关于用户：..."，让模型可以自然说"根据我的记忆你是..."
  - `PersonaSource` 分两段注入（两组 bullets + 不同标题）
  - `remember_persona` tool 入参加 `subject`（默认 `agent`，description 给清例子）
  - 反思 Job 同时产两类 candidate（同一批对话既能抽"用户是 X"也能转译"回答时应该 Y"）
  - 审核 UI：PersonaReviewBanner 标签区分两类
  - 工作量估计：~2h；改动集中在 memory schema + persona.ts + remember-persona.ts + reflection/runner.ts + banner.tsx

#### 上下文分层机制 · 剩余工作
- [ ] **Session Topic 话题漂移主动检测**（v0.2.4 只做了被动识别，还没做漂移检测）
  - 现状：每 4 轮会识别一次 topic；话题如果聊着聊着漂了，要等下一次 4 轮周期才更新
  - 目标：每轮结束时 aux 快速判"topic 是否漂移"（是 → 立即重识别），否则按原周期
  - 或者更简单：`shouldIdentify` 加一个"相似度跌破阈值"的触发条件
- [ ] **旧 visit 消息按距离/字数裁剪**（问题 4 的加强版）
  - 当前 v0.2.4：非当前 visit 的消息**全保留**前置 system 段。长期积累下来可能塞爆上下文
  - 目标：按 `(visitId, 距今时长)` 降权；同一 visit 只保留最后 N 条；再旧的走向量召回补位

- [ ] **召回粗判（`RECALL_PATTERNS`）升级**（用户反馈 2026-04-24 · 粗判过于保守导致漏报）
  - 文件：`packages/agent/src/context/recall-triggers.ts`
  - 问题：现状只有约 6 个中英正则（"上次/之前/还记得/that topic"等），且是**第一道 AND 门**——
    一旦漏掉，整条召回链路（精判→向量→邻居拼接）**全部不会执行**，用户感受就是"该 recall 的时候没 recall"。
  - 漏报典型场景：
    * `"这个方案跟那个比起来..."`（省略"之前"时无时间锚点，但实际在引用历史）
    * `"你觉得这个实现好还是我们说的那个好"`（"我们说的那个"词组未命中，单字"那"未入模式）
    * `"再帮我看看那篇文章里的代码"`（"那篇"虽然在模式中，但 `/那篇/` 可能误伤"那篇文章"）
    * 纯语义指代类（"它"、"这个想法"、"之前提过的那种写法"）完全没模式能覆盖
  - 设计注释本来写了"宁可误报不可漏报"，但实际词表偏保守——**需要反过来思考**：
    精判是 aux LLM 调用，每次 ~200-800ms；粗判多让 20% query 过门换高召回率是划算的。
  - 优化路线（按成本递增）：

    **路线 A · 扩充正则词表**（~30 分钟，最轻量）
    - 中文补：单字"那"的语境门（跟 /个|种|款|篇|段|回|次|件/）、"之前说的"变体、"我记得..."起手式
    - 英文补：`I think we`, `earlier you said`, `that thing`, `the one we`, `back then`
    - **指代词粗触发**：独立正则 `/\b(那|这|it|that|this)(.{0,5})(个|方案|实现|写法|想法|讨论|thing|approach|solution)\b/`，
      但只在 user input 足够长（>20 字）时生效，避免"这段代码什么意思"误触
    - 评估：对 50 条真机 query 跑 recall 决策，统计漏报/误报率

    **路线 B · 加"显式无时间锚点但有指代"的启发式**（~1h）
    - 即使没有时间词，只要 user 用了"它/那/this/that + 抽象名词"，也触发粗判（送 aux 精判兜底）
    - 本质是**降低粗判漏报**、**把准确性压力交给精判**
    - 需要人工标注小数据集调阈值，避免所有含"这"字的句子都触发

    **路线 C · 换开源短文本分类**（~2-4h，最彻底）
    - 候选一：**轻量 LLM classifier**（本地 2B-4B 模型，通过 WebLLM / transformers.js 跑）
      - 优点：零成本、离线、延迟 <100ms
      - 缺点：引入 ~200MB wasm + 模型加载时间；对千问 Turbo 的对齐需要 few-shot prompt
    - 候选二：**规则库 `wink-nlp` + 自定义意图模板**
      - [wink-nlp](https://github.com/winkjs/wink-nlp)：轻量英文 NLP，支持意图分类（200KB）
      - 不直接支持中文；但能覆盖英文侧 "recall intent" 模式
    - 候选三：**直接把粗判和精判合并成一次 aux 调用**（放弃粗判）
      - 方向性选择：不再用正则拦截，每条 user input 都送 aux 精判（加 24h LRU 缓存避免短期重复问句）
      - 成本：aux Turbo 按 ¥4/百万 tokens，~5 token/次 prompt ≈ 每 50w 次消息 ¥1。真机用一年也花不了多少
      - 最简单、最鲁棒；失去"零成本快拦"但换来零漏报
    - 候选四：**embedding-based 粗判**（前置 embedding）
      - 预存"典型 recall 意图"的 ~20 条种子 embedding；每次 user input 先 embed → 与种子做余弦 → 最大相似度 >阈值 则过门
      - 成本 ~300ms/次；节省在"不用调 aux LLM"
      - 只有 embedding Provider 配置齐全时可用
  - **推荐路径**（真要做时）：**路线 A 先做**（把漏报降到 <10%），真机跑一版看数据；如果仍不满意再评估路线 C 候选三（合并成 aux，最彻底）。
  - 工作量估计：A=0.5h，C3=1.5h（含缓存 + 单测）
  - 验证办法：收集 50-100 条真机 query，人工标注 should_recall 真值，对比粗判判定，统计漏报率与误报率

- [x] **跨 visit 时间维记忆检索 · Chronological Index**（用户反馈 2026-04-24 · **已随 v0.4.0 完成**[^chrono-v040]）
  - 动机：当前 `recall_memory` 基于语义向量，无法处理"今天看了哪些文章"、"本周读了什么"这类**元查询**——embedding 基于内容编码，时间维根本不在语义空间里。用户在新域名下问这类问题会拿到"未找到"，体验差。
  - v0.2.3 的小修补：`recall_memory` 已能识别这类时间维元查询并返回 `reason='time_query_unsupported'` 的明确提示（避免假阴性），主 LLM 坦诚告诉用户"这类查询暂不支持"。完整方案见下。
  - 目标设计：
    - **新 tool · `list_recent_visits`**：按时间窗口列 visit_summary（参数：`timeRange`（today/yesterday/this-week/custom-start-end）、可选 `domain` 过滤、`limit`）。返回结构化的"visit 清单"——每条含 URL / title / summary / timestamp / domain。
    - **扩展 `recall_memory`**：接受可选 `timeRange` / `domain` / `articleId` 参数。当前底层 `DexieMemoryStore.recall` 已支持这些过滤（v0.2 就写好了，只是 tool 层没暴露）。
    - **主 system prompt 提示**：加一条"对'今天/本周看了什么'这类时间维元查询用 `list_recent_visits`，而非 `recall_memory`"的行为守则。
    - **自动路由（可选）**：`RelevantMemorySource` 在识别到时间维查询时，跳过向量召回，直接调用 `list_recent_visits`——让用户感知不到 tool 边界。
  - 产品哲学：这是"**助手在某项特定工作 / session 之外的记忆**"——不被 canonicalUrl / visitId 限制，类似人类的"时序自传式记忆"。

[^chrono-v040]: 2026-05-06 归档勘误：本条实际已随 v0.4.0 落盘，代码位于 `packages/tools/src/definitions/list-recent-visits.ts`（新 tool 实装）+ `packages/agent/src/context/time-query.ts`（时间维查询识别与自动路由）。ROADMAP 历史上误留在 `v0.2.5+（未来方向）`，此处补勾。
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
- [x] **移除 v0.1 向后兼容代码**（已于 [v0.3.0](./CHANGELOG.md#v030--移除-v01-兼容--breaking-change) 完成）
  - `STORAGE_KEYS.QWEN_CONFIG` / `QwenConfig` / `DEFAULT_QWEN_CONFIG` / `migrateQwenConfigToMain`
  - `bootstrap.ts` / `OptionsForm.tsx` 的 v0.1 迁移链路
  - `MemoryRecord.sessionId` / `PersonaSource.sessionId`
  - `MemoryRecordType` 收窄为 `'message' | 'persona' | 'visit_summary'`
  - `UIMessage.visitId` / `SlashCommandContext` 5 项新增能力 / `MemoryStore` 14 项原可选方法
    全部收紧为必填

#### 工程治理 · Prompt / Agent 参数化

- [ ] **集中化的"代码配置文件"（prompt / agent 超参共享配置）**（用户提出 2026-05-01）

  **用户故事**
  作为 **Agent / Prompt 维护者**，我希望**有一份集中管理的配置文件(或配置模块)**，用于存放目前散落在各 prompt / agent / tool 调用点的"运行时可调参数"，以便**只改配置就能微调 agent 行为，不需要改动代码或重写 prompt**。

  **背景与价值（Why）**
  - 现状：Agent 的优先级、`maxTurn`、反思 Job 间隔、召回粗判触发词、tool 注册 deps、system prompt 片段 等超参分散在 `packages/shared/src/config.ts`、`packages/agent/src/loop.ts`、`packages/agent/src/reflection/*`、`packages/tools/src/definitions/**`、`.claude/agents/*.md` 等多个位置；
  - 痛点：每次想做"A/B 微调"——比如"把主循环 maxTurn 从 8 调到 12"、"把某 agent 优先级降一级"、"把某个 tool description 措辞改一版"——都要修改代码并重新构建，改动分散、容易遗漏，且**难以可视化对比**不同参数下的效果；
  - 价值：
    1. **微调能力**（fine-tune-able）:改配置即改行为，减少代码改动 → 降低回归风险
    2. **集中可见**：一眼看到"这个 agent / 这个 tool / 这个 prompt 当前用的是什么参数"
    3. **可版本化**：不同 profile(如 `default` / `cheap` / `aggressive-recall`)可切换
    4. **便于协作调参**：product-manager 不写代码也能提调参 PR

  **范围（What · MVP）**
  1. 新增 `packages/shared/src/agent-config.ts`（或 `packages/shared/config/agent.ts`），作为**唯一可信源**；
  2. **抽取首批参数**到 "shared" 区域（命名建议 `AgentRuntimeConfig`）：
     - 各 agent 的 **priority**（若有 orchestrator 调度优先级的概念）
     - 主循环 / 各 agent 的 **maxTurn**（最大回合数）
     - 辅 LLM 调用的 **temperature / topP / maxTokens**
     - 反思 Job 的 **scanIntervalMinutes** / **retryLimit** / **batchSize**
     - 召回链路的 **keyword 粗判触发集合**、**intent 精判置信度阈值**、**向量 topK**、**邻居消息拼接窗口**
     - 各 tool description 中"可外置"的文案片段（如 TODO 推进规则的强度措辞）
     - SessionTopic `shouldIdentify()` 的**触发周期轮数**与**漂移阈值**
  3. 留一条通用扩展点:`share.extras: Record<string, unknown>`，方便后续新增参数不立刻改 schema；
  4. bootstrap 处统一 `loadAgentRuntimeConfig()` → 注入到 Loop / Reflection / RelevantMemorySource / buildPhase2Tools 等消费方；
  5. 提供 `DEFAULT_AGENT_RUNTIME_CONFIG` 常量，保证零配置下行为与当前完全一致(向后兼容)。

  **初步验收标准**
  - [ ] 至少抽取 **5 类参数**到新配置文件(maxTurn / agent priority / reflection 间隔 / 召回阈值 / tool 文案片段)
  - [ ] 改配置**不需要改业务代码**即可生效(Loop / Reflection 等消费方通过 config 读取，不再出现魔法常量)
  - [ ] 全部消费方 **100% 走 config**，`Grep` 在旧位置找不到遗留魔法常量
  - [ ] 单测覆盖:配置默认值、覆盖值、扩展字段合并、边界非法值(如 `maxTurn<=0`)被 clamp
  - [ ] 不破坏 v0.5.0 已有行为(既有测试全绿)
  - [ ] `docs/` 内附 **配置速查表**:每一项的名称、默认值、取值范围、影响面
  - [ ] (可选 / 验收加分项)配置页"调试" Tab 新增只读视图，展示当前生效的 `AgentRuntimeConfig` JSON

  **优先级建议**
  - **🟧 中**。不直接解决用户可感知痛点，但**显著降低后续所有 prompt / agent 调优的成本**，属于"越晚做越贵"的基础设施治理项。建议在 v0.6(DSL 自学习提取器)之前或并行完成,因为 v0.6 会引入更多可调参数,若届时仍无集中配置，碎片化会加剧。

  **可能涉及的实现要点(提示，非方案)**
  - 位置:优先 `packages/shared/src/`(符合"依赖方向严格单向"红线，任何层都能读)
  - Schema:建议用 **纯 TypeScript interface + `satisfies` + `Object.freeze`**，不引入 zod 等新依赖(除非已有);
  - 配置分层:`DEFAULT` → `profile 覆盖` → `用户 chrome.storage 覆盖`(三层 merge);
  - 兼容性:现有魔法常量保留为 DEFAULT 的取值，**行为零变化**；
  - 风险点:
    - ⚠️ 不要把 **API Key / baseURL / model id** 塞进来(这些是"用户配置",不是"超参");职责要分清
    - ⚠️ system prompt 全文不放 config(太重,且涉及 i18n);只放"可外置的文案片段/强度词"
    - ⚠️ 配置 reload 时机:MVP 只在 bootstrap 加载一次，不做热更新;写到红线里
  - 测试策略:`packages/shared/src/__tests__/agent-config.test.ts` 覆盖 DEFAULT 冻结、merge 语义、clamp 边界

  **范围边界（本次不做）**
  - ❌ 不做 GUI 编辑器(先只支持改源码常量 / chrome.storage key)
  - ❌ 不做多 profile 切换 UI(数据结构预留，实现延后)
  - ❌ 不把 prompt 全文搬进 config(仅外置可调片段)
  - ❌ 不做配置热更新(bootstrap-time 加载)

### 架构红线（ESLint 强约束）

- Agent 层禁止 `import 'ai'` / `@ai-sdk/*`（通过 LLMProvider / EmbeddingProvider 接口访问）
- **v0.2 起**：Memory 层**解除** dexie 约束（Phase2 已落地）
- Tools 层仍禁止 `tesseract.js`（Phase3-a 才解禁）
- ESLint `no-eval` 持续通过
- `MemoryStore.remember / recall` 签名不得修改；其它方法 v0.3 起全部必填，NullMemoryStore 提供 no-op 兜底
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

> **治理注脚（2026-05-06）**：CheckerAgent 的**实现路径**已确定复用 `docs/backlog.md` · [B-002 · 自定义智能体](./backlog.md#b-002--自定义智能体领域专家) 的通用框架——作为 B-002 下的一个"内置 background 型智能体"实例落地，不单独演化一套机制。本节的设计目标、触发机制、架构约束、禁止事项均保持权威；具体工程实装承接在 B-002 的"智能体类型 / 触发方式 / 输出通道"三项 schema 扩展之上。版本主题（v0.8 · CheckerAgent · 实时提醒）不变。

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

> 承接 [B-002](./backlog.md#b-002--自定义智能体领域专家)：上述四项（独立 Context 组装 / 旁路输出通道 / 默认关闭 / 页面事件触发）在 B-002 框架下对应 `type='background'` + `outputChannel='side-channel'` + `defaultEnabled=false` + `trigger.kind='dom-event'` 四个 schema 字段的组合配置——**不新造架构**。

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
- [ ] **Provider 层抽象**以支持 OpenAI / Anthropic / Ollama 等（轻量基类 `OpenAICompatibleProvider` 已随 v0.6.0-beta.2 抽离并承载了 Qwen + DeepSeek 两家实现；OpenAI / Moonshot / Anthropic / Ollama 仍延后）
- [ ] **WorkingMemory 归档到 Episodic**的具体内容格式（v0.2.1 填充时完善）
- [ ] **域名级 DSL 自学习提取器**（§1）
- [ ] **OCR / 多模态识图**（§3）
- [ ] **CheckerAgent / 实时提醒**（§4）
- [ ] **云端同步**（§5）
- [x] **`chrome.alarms` reflection-scan 的真正执行器**（v0.2.1 实装 → v0.5.0 迁移到 offscreen）✅ 已于 v0.5.0 完成

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
