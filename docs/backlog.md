# Doc Assistant · 产品 Backlog（未排期需求池）

> 本文件用于收集**尚未进入版本路线（ROADMAP）**的候选需求，做产品视角的梳理：背景 / 验收标准 / 优先级 / 依赖关系。
>
> 一旦某条需求被纳入某个 milestone，就从本文件"剪切"到 `docs/ROADMAP.md` 或 `docs/requirements/<version>-xxx.md`，并在本文件留一行指针（`→ 已迁至 v0.x.x`）。
>
> 最新更新：2026-05-06（B-009-b 迭代搜索特性入档 + 依赖关系翻转:强依赖 B-003 subAgent + 排序调整紧跟 B-003)

---

## 索引

| 编号 | 标题 | 优先级 | 依赖 | 状态 |
| --- | --- | --- | --- | --- |
| [B-001](#b-001--接入-deepseek-相关模型) | 接入 DeepSeek 相关模型 | **P0** | — | ✅ 已立项/待开发（v0.5.1） |
| [B-002](#b-002--自定义智能体领域专家) | 自定义智能体（领域专家） | **P1** | — | 待排期 |
| [B-003](#b-003--subagent--子智能体委派) | subAgent · 子智能体委派 | **P2** | B-002;隐性上游 B-009-a;下游启用 B-009-b | 待排期 |
| [B-004](#b-004--skills--可索引可调用的技能包) | Skills · 可索引可调用的技能包 | **P2** | （弱依赖 B-002 / B-003） | 待排期 |
| [B-005](#b-005--引用标签ref-chip在气泡中的可视化与富媒体扩展) | 引用标签（Ref Chip）在气泡中的可视化与富媒体扩展 | **P1** | 与 Provider / ChatChunk 契约弱耦合；与 B-002/B-003/B-004 正交 | 待排期 |
| [B-006](#b-006--记忆审核文案关于你--关于用户指代歧义) | 记忆审核文案「关于你 / 关于用户」指代歧义 | **P1** | 独立（文案级） | ✅ 文案已定稿（2026-05-06），待排期搭车实装 |
| [B-007](#b-007--persona-记忆系统质量抽取边界--整合工具--模型可切换) | Persona 记忆系统质量：抽取边界 + 整合工具 + 模型可切换（内部分 A / B / C 三子项） | **P0**（A）/ **P1**（B / C） | A 独立；B 与 B-004 弱协同；C 与 B-001 弱协同 | 待排期（A 紧跟 B-001） |
| [B-008](#b-008--开源仓库基础设施) | 开源仓库基础设施（License / CONTRIBUTING / Issue·PR 模板 / 截图素材 / CI 徽章真实化） | **P2** | 独立 | 未排期（随开源节奏推进） |
| [B-009](#b-009--给-llm-增加-web-能力webfetch--websearch--待调研) | 给 LLM 增加 Web 能力：WebFetch / WebSearch 工具（内部分 a · WebFetch、b · WebSearch 两子项） | **P1**（a）/ **P2**（b） | a 独立(是 B-003 隐性上游);**b 强依赖 B-003 subAgent**(迭代搜索需独立上下文子 agent);与 B-004 弱协同 | **待调研**（用户自陈"没思路",先做对标研究) |

**建议排期顺序（PM 视角）**：**B-001 → B-007-A → B-006 → B-005 → B-002 → B-007-B → B-007-C → B-004 → B-009-a → B-003 → B-009-b**（B-006 / B-007-A 为小改，可搭车在 B-001 迭代里顺手做;B-009-a 明确排在 B-003 之前,避免 subAgent 落地时缺 WebFetch 导致体感差;**B-009-b 紧跟 B-003 之后**,因为迭代式搜索本质需要独立上下文的子 agent,没有 subAgent 只能退化成"搜一次返回列表"的弱版;详见文末"优先级总论"）。

---

## B-001 · 接入 DeepSeek 相关模型

> ✅ **已升级为正式需求**（2026-05-06），见 [`docs/requirements/v0.5.1-deepseek-provider.md`](./requirements/v0.5.1-deepseek-provider.md)。本节保留作为**背景档案**，新的验收标准以需求文档为准。

### 背景 / 动机

- 当前 `packages/provider/` 只实现了 `QwenProvider` + `QwenEmbeddingProvider`（v0.2 定稿），三套 Provider 配置（`main` / `auxiliary` / `embedding`）从 schema 层面已经是通用的 `baseUrl + model + apiKey`，但**具体适配只有阿里云一家**。
- ROADMAP · §6 明确把"Provider 层抽象以支持 OpenAI / Anthropic / Ollama 等"列为延后项；DeepSeek 属于同一抽象范畴，但在用户群体里**需求呼声明显更高**——V3 / R1 系列在中文开发者场景里是当前成本 / 效果比最优的选择之一。
- 对本项目的直接价值：
  1. **辅 LLM 降本**：SessionTopic 识别、反思 Job、召回 intent 精判这些**高频低难度任务**非常适合用 DeepSeek 的便宜模型跑，比当前默认"复用主模型"更划算。
  2. **推理场景**：R1 的思维链输出能让"反思 Job / Persona 抽取 / 冲突检测"质量上一个台阶。
  3. **用户选择权**：填 API Key 即可切换，不改代码。
- DeepSeek 的 API 基本兼容 OpenAI 协议，接入成本**可控**（PM 视角不做技术判断，但这是把它和真正的 Provider 层大重构区分开来的关键依据）。

### 初步验收标准

- [ ] 配置页 `main` / `auxiliary` / `embedding` 三套 Provider 下拉里**新增 "DeepSeek" 选项**，与 Qwen 并列。
- [ ] 用户填入 DeepSeek 的 `apiKey` + `baseUrl`（留默认值）+ `model id`（如 `deepseek-v4-flash` / `deepseek-v4-pro`）后，**主对话、辅助任务、embedding 三条链路分别可用**（embedding 如 DeepSeek 无官方 embedding，此项可标"不适用"并在 UI 上明确）。
- [ ] 流式输出、tool calling、usage 统计字段均能正确归一化到现有 `ChatChunk` 契约（即 sidebar / RelevantMemorySource / ReflectionRunner 等所有消费方无感）。
- [ ] 新增 ≥ 1 组端到端回归：`packages/provider/src/__tests__/deepseek.test.ts` 覆盖 normal / tool-call / error 三条路径。
- [ ] 文档同步：README "支持的模型" 章节、ROADMAP · §6 把该条目勾掉。
- [ ] 不破坏现有 Qwen 链路（既有单测全绿）。

### 优先级建议

**P0**。

理由：
1. **用户基数覆盖面最广**——DeepSeek 是"不付高价也能体验完整 Agent 能力"的敲门砖，属于**产品可用性**而非"锦上添花"。
2. **改动面小、风险可控**——协议兼容性好，不需要动 Agent / Memory 层任何接口。
3. **为 B-002 / B-003 提供便宜的"辅助模型"燃料**——自定义智能体、subAgent 一旦落地，必然会有"跑一堆辅助小任务"的需求，DeepSeek 的价格带是最合适的。

### 可能的依赖关系

- **无硬依赖**，可独立推进。
- 与 ROADMAP · v0.2.5+ 的 "Token 用量看板" **天然协同**：一旦用户接入多家 Provider，用量看板的价值立刻凸显。建议在同期或相邻迭代一起推。

---

## B-002 · 自定义智能体（领域专家）

### 背景 / 动机

- 当前产品定位是"通用文档阅读助手"，核心 ContextSource 组合（SystemPrompt / Persona / SessionTopic / WorkingMemory / ChatHistory / RelevantMemory）**对所有用户、所有场景一视同仁**。
- 但真实场景里，用户在**不同领域**需要的"助手性格 + 工具集 + 优先关注点"差异极大：
  - 在 arXiv 读论文 → 需要"学术助手"：强调方法论、引用追溯、公式解释
  - 在 GitHub 读源码 → 需要"代码助手"：强调调用链、边界条件、重构建议
  - 在知乎 / 小红书 → 需要"信息核查助手"：强调来源可靠性、偏见识别
  - 在 Notion / 飞书文档 → 需要"协作助手"：强调结构化总结、待办提炼
- 现状的 Persona 机制是**单一维度**（"Agent 长期指令" + "用户画像"），无法承担"一整套领域人设 + 工具包 + 提示词片段"的切换能力。
- 本条需求本质是：**把"智能体"提升为一等公民的用户可配置对象**，用户可以自定义一组领域专家，Agent 在合适的场景自动激活（或用户手动切换）。

### 与 ROADMAP · v0.8 `CheckerAgent` 的治理关系（2026-05-06 并轨）

> **本条已采纳**：`CheckerAgent`（ROADMAP · §4 / v0.8）**不再作为独立机制**演化，而是**作为 B-002 框架下的一个内置智能体实例**实现——属于 B-002 的"特例 / 官方预置"，共用同一套"智能体一等对象 + 领域匹配 + 系统提示词 + tool 勾选 + （可选）独立 Provider"抽象。
>
> 对 B-002 的框架要求（在下方验收标准中已显式体现）：
> 1. 智能体配置 schema 必须能承载 `CheckerAgent` 这类"**被动触发 + 旁路输出**"的类型——即：除了"主对话型"智能体（默认），还需支持"后台/旁路型"智能体（由页面事件而非用户输入触发，输出不进主消息流）。
> 2. 触发机制抽象层要能覆盖：(a) 域名/URL/关键词匹配、(b) 用户手动 `/agent` 切换、(c) **页面事件驱动**（`IntersectionObserver` / `MutationObserver` / 其它 DOM 事件）——其中 (c) 是 `CheckerAgent` 的核心诉求。
> 3. 智能体的"输出通道"要支持两种形态：主消息流（默认）/ 旁路流（Toast / 右上角轻提示 / 折叠气泡等）。`CheckerAgent` 默认走旁路流。
> 4. 智能体可声明"启用开关默认值"——`CheckerAgent` 默认 **关闭**，与 ROADMAP · §4 红线一致。
>
> 影响：ROADMAP · v0.8 仍然保留"CheckerAgent · 实时提醒"这一对外版本主题，但**实现路径改为基于 B-002 框架扩展，不再单独演化**。详见 [`docs/ROADMAP.md` · §4](./ROADMAP.md#4--phase-3-bcheckeragent-与实时提醒)。

### 初步验收标准

- [ ] 配置页新增 "智能体" Tab，用户可以创建 / 编辑 / 删除 / 排序自定义智能体条目，每个条目至少包含：
  - 名称、图标、简述
  - 领域匹配规则（域名白名单 / URL 正则 / 关键词，可留空=全局可用）
  - 系统提示词（领域专家的"人设 + 工作方式"，多段文本）
  - 可选：启用 / 禁用哪些 tool（从现有工具注册表里勾选）
  - 可选：绑定专属 Provider 配置（在 B-001 基础上可选不同模型）
  - **智能体类型**：`interactive`（默认，参与主对话）/ `background`（被动触发 + 旁路输出，为 `CheckerAgent` 等预留；MVP 可先只落 `interactive`，但 schema 字段必须预留，避免 B-002 落地后 v0.8 再来改配置表）
  - **触发方式**：支持 (a) 域名/URL/关键词匹配（自动激活）、(b) 用户手动 `/agent <name>`、(c) **页面事件驱动**（`IntersectionObserver` / `MutationObserver` / 其它 DOM 事件；MVP 可只实现 (a)(b)，(c) 在 schema 上留位）
  - **输出通道**：`main-stream`（默认，进主消息流）/ `side-channel`（旁路：Toast / 轻提示 / 折叠气泡）。`background` 型智能体默认走 `side-channel`
  - **默认启用开关**：允许预置智能体声明"开箱默认关闭"（`CheckerAgent` 首次启用需用户主动打开，符合 ROADMAP · §4 红线）
- [ ] 运行时：sidebar 顶部出现"当前智能体"指示器，支持**自动激活**（匹配命中）+ **手动切换**（下拉菜单）。
- [ ] 智能体切换时，**仅替换** SystemPrompt + tool 注册范围 + （可选）Provider；**不清空** Persona / Episodic / WorkingMemory（与 `/new` 一致的红线：切人设不擦记忆）。
- [ ] 预置 2–3 个开箱即用模板（"学术论文助手" / "代码阅读助手" / "信息核查助手"），用户可一键克隆再编辑。
- [ ] 斜杠命令：`/agent <name>` 手动切换；`/agent` 单独列出当前所有智能体。
- [ ] 数据持久化在 `chrome.storage.local`（不进 IDB，理由：**配置**而非**记忆**）。
- [ ] 既有"默认通用助手"作为兜底智能体永远存在、不可删除。
- [ ] 文档更新：README 新增"自定义智能体"一节；ROADMAP 追加版本条目。

### 优先级建议

**P1**。

理由：
1. **显著放大产品差异化**——同赛道扩展大多是"一个通用 chat"，可定制智能体是把"阅读助手"做成"可扩展平台"的关键一步。
2. **是 B-003（subAgent）和 B-004（skills）的**前置抽象**——没有"智能体"这个一等对象，这两条无从挂载。
3. 但不像 B-001 那样"不做就用不了"——老用户可以继续用默认助手，属于**增量价值**。
4. 工作量估计比 B-001 大不少（UI + 运行时切换 + 匹配规则引擎），放在 P1 更符合节奏。

### 可能的依赖关系

- **可独立推进**，与 B-001 无硬依赖。
- **强前置关系：B-003 / B-004 的"所属智能体"语义都依赖本条先落地**。如果跳过本条直接做 subAgent，会出现"子 agent 挂在谁身上"的架构空洞，返工风险高。
- 与 ROADMAP · v0.8 的 `CheckerAgent` **已确认合并**（2026-05-06）：`CheckerAgent` 作为 B-002 框架的内置"背景型 / 旁路型"智能体实例存在，不再单独演化一套机制。详见上文"与 ROADMAP · v0.8 `CheckerAgent` 的治理关系（2026-05-06 并轨）"小节与 [ROADMAP · §4](./ROADMAP.md#4--phase-3-bcheckeragent-与实时提醒) 中的注脚。

---

## B-003 · subAgent · 子智能体委派

### 背景 / 动机

- 当前 `packages/agent/src/orchestrator.ts` 已有 `AgentOrchestrator` 与 `register(agent)` 的骨架，但实际运行**只有一个 ChatAgent 在跑**——"多 agent"架构是留着的、没长出来。
- 真实场景中，主 Agent 经常面对"**一个大任务 + 几个专门子任务**"的结构：
  - "帮我把这篇论文里所有实验表格整理成 markdown" → 主 agent 规划 + 多个子 agent 分别处理每张表
  - "对比这个 repo 和上次看的那个 repo 的架构差异" → 主 agent 调度 + 代码分析子 agent × 2 + 差异归纳子 agent × 1
  - "把这页知乎回答里的事实论断都查一遍" → 主 agent 拆任务 + 信息核查子 agent × N
- 如果**没有** subAgent，主 agent 就会陷入"上下文过载 + tool 调用链过长 + 推理深度不够"的困境；有了 subAgent，可以让每个子任务**带着干净的、裁剪过的上下文**独立跑完再返回结果，主 agent 只管汇总。
- 这也是业界（Claude Code、Cursor、Devin 等）验证过的范式：**主 agent = 规划者 + 汇总者**，**子 agent = 独立上下文的执行者**。

### 初步验收标准

- [ ] 在 B-002 的"智能体"基础上，任一自定义智能体可以标记为 `invocable-as-subagent: true`（是否允许被其它 agent 作为子 agent 调用）。
- [ ] 新增一个主 agent 可用的 tool：`delegate_to_subagent(name, task, contextHints)`
  - `name`：目标子智能体名
  - `task`：要子 agent 完成的自然语言任务描述
  - `contextHints`：可选，父 agent 精选要传给子 agent 的上下文片段（默认**不继承**父的 ChatHistory，仅传 SystemPrompt + 任务描述 + hints）
- [ ] 子 agent 执行时：
  - **独立 ContextSource 组装**，不污染父 agent 的上下文
  - **独立 tool-call loop**，有自己的 maxTurn 上限（P2 建议 ≤ 父的一半）
  - **Persona / Episodic 可读不可写**（子 agent 写记忆默认关闭，避免多个 subAgent 并发写产生冲突；可后续放开）
- [ ] 子 agent 完成后，返回**结构化结果**（text + 可选 structuredData）给父 agent，父 agent 作为 tool result 继续推进。
- [ ] UI：sidebar 在对话流里显示"调用子智能体 X 中..."的可折叠气泡，展开可查看子 agent 的完整对话（透明可审计，不默认展开）。
- [ ] 防御性红线：
  - **不支持嵌套**（subAgent 不能再委派 subSubAgent；MVP 范围明确关掉）
  - **单次会话最多并行 N 个子 agent**（防爆炸，建议 N=3）
  - **Token 预算隔离**：subAgent 的 token 用量单独计入 B-001 同期的用量看板
- [ ] 单测：`orchestrator.test.ts` 覆盖正常委派 / 子 agent 失败兜底 / 并发隔离 / 嵌套拒绝。

### 优先级建议

**P2**。

理由：
1. **价值显著但适用场景偏窄**——大多数用户的日常使用（读一篇文章、问几个问题）根本用不到 subAgent，受益面不如 B-001 / B-002 广。
2. **架构复杂度高**——并发、token 预算、上下文隔离、UI 呈现、失败回滚都是"做可以做，做好很难"的陷阱点。建议放在 B-002 稳定一个版本以后再做。
3. **需要 B-002 先落地**——没有"智能体"一等对象，subAgent 无处挂载。
4. 可以作为"产品进阶能力"的宣传亮点，但不适合放在 P0/P1 打扰核心路径。

### 可能的依赖关系

- **强依赖 B-002**：必须先有"自定义智能体"这个一等对象，subAgent 才有所指。
- **隐性上游 B-009-a(WebFetch)**:子 agent 的典型场景"拉几个网页比对一下"离不开 WebFetch;建议 B-009-a 先行。
- **启用下游 B-009-b(WebSearch)**(2026-05-06 补录):迭代式 WebSearch(搜 → 拉 → 判 → 再搜)本质需要独立上下文、能自循环、不污染主对话的子 agent —— **B-003 是 B-009-b 的硬前置,B-009-b 是 B-003 的典型应用场景**。B-003 的验收标准"子 agent 独立 ContextSource + 独立 tool-call loop + 独立 maxTurn 与 token 预算"恰好是 B-009-b 迭代循环的基础设施。
- 与 B-001 无直接依赖；但如果 B-001 已落地，子 agent 能用更便宜的模型跑，成本更可控——**弱协同**。
- 与 B-004（skills）**可以独立**，但如果两者都做了，子 agent + skill 的组合是非常强大的"专家 + 工具包"模式（业界验证路径）。

---

## B-004 · Skills · 可索引可调用的技能包

### 背景 / 动机

- 用户原话：**"支持 skills（这点可能需要我们自己实现索引，但是原理可以照抄）"**
- 对标的是 Claude / ChatGPT "skills"、Cursor rules、Continue slash commands 等业界形态——核心思想：
  1. 技能 = **一段写给 agent 看的说明文档 + 可选的可调用脚本 / tool 组合 + 触发语义**
  2. 技能**按需检索**（不全量注入 system prompt），否则会把上下文打爆
  3. 检索机制靠**索引**（embedding / BM25 / 规则匹配 / LLM 决策）
- 本项目有独特的"必须自建索引"的理由：
  - 扩展跑在浏览器里，**不能依赖外部 skill 中枢服务**
  - 已有 `QwenEmbeddingProvider` 基础设施，`DexieMemoryStore` 的向量能力也是现成的——**索引层可复用**
  - 但"skill registry + 描述模板 + 触发 prompt" 都需要我们**自己定义 schema**
- 业务价值：
  - 用户可以自己写或者"下载"（本地导入 JSON）一个"PDF 论文解读"技能、"代码安全审计"技能、"英文学术润色"技能……
  - Agent 在面对用户请求时**先检索匹配的 skill**，命中则载入其 prompt + tool 集合，未命中则走常规链路
  - 与 B-002 的区别：智能体是"长期人设"，技能是"短期任务包"，二者互补——智能体是**谁在答**，技能是**怎么答这一类问题**
- 明确"原理可以照抄"的部分：schema 设计、触发机制、索引策略、prompt 模板可以参考业界；**索引实现必须本地化**。

### 初步验收标准

**MVP（最小可用）**：

- [ ] 定义 `Skill` schema（纯数据）：
  - `id` / `name` / `description`（给 agent 看的触发语义）/ `triggerKeywords` / `triggerRegex`
  - `instructions`（skill 激活后注入 agent 的 prompt 片段）
  - `requiredTools`（若需要特定 tool，在已注册表里引用）
  - `embedding`（由索引构建时写入，向量化 `description + triggerKeywords`）
- [ ] 提供 2 种技能来源：
  - **内置技能**：随扩展一起分发（`packages/skills/builtin/` 静态 JSON）
  - **用户自定义**：配置页"技能" Tab 手动添加 / 粘贴 JSON 导入
- [ ] 实现 `SkillIndex`（自建索引）：
  - 启动时把所有技能的 `description + keywords` 向量化存入 IDB（新表 `skills` + `skill_embeddings`）
  - 支持 **规则召回**（keyword / regex 命中）+ **语义召回**（embedding 余弦）双通道，**取并集**后按置信度排序
- [ ] 新增 `RelevantSkillsSource`（新 ContextSource，priority 待 ROADMAP 批准新占位；不复用 40 / 50 等已占用数字），每轮对话开始时：
  1. 取用户最新输入 → 调用 `SkillIndex.search(query, topK=3)`
  2. 命中的 skill 的 `instructions` 以"可用技能：..."的段落注入 system prompt
  3. 命中 skill 依赖的 tool 动态加入 tool 列表
- [ ] 斜杠命令 `/skill <name>` 强制激活某技能；`/skill` 列出所有已安装技能。
- [ ] UI：sidebar 在当前对话里显示"本轮命中技能：XXX"的小徽章（可点击查看完整 instructions）。
- [ ] 红线：
  - skill 不得注入可执行 JS 代码（与 ROADMAP · §1 "LLM 生成 DSL 不生成 JS" 原则对齐）
  - skill 的 `requiredTools` 必须是**已注册**的 tool，不能动态声明新 tool
  - 用户导入的 JSON 必须经过 schema 校验（使用现有 JSON Schema 机制）

**加分项（可留到下一迭代）**：

- [ ] 技能的"使用次数 / 最近命中"统计，帮助用户识别哪些技能真正在用
- [ ] 技能的分享格式（导出 JSON 并复制到剪贴板），逐步建立社区内流通
- [ ] 技能与 B-002 "智能体"的绑定：某个智能体只加载特定 skills 子集

### 优先级建议

**P2**。

理由：
1. **产品价值高但是"可延后"**——没有 skills 用户也能用；有了 skills 是"好用得多"。
2. **实现复杂度中等偏高**——索引、检索、注入、UI、导入导出是一整条链路；建议 B-002 稳定后再做。
3. **和 B-003 在复杂度梯度上属于同一档**，但 PM 判断 B-003 的架构风险高于 B-004；两者都做的话建议 **先 B-004 再 B-003**——skill 的"无状态、可检索"比 subAgent 的"有状态、可并发"更容易打磨。
4. "原理照抄 + 索引自建"这个约束让本条**更适合在基础设施（B-001）和智能体（B-002）稳定后再启动**，避免边建边改。

### 可能的依赖关系

- **弱依赖 B-002**：技能机制**本身**可以独立存在；但"把一组技能绑定在某个智能体下"是非常自然的组合——如果先做 B-004 再做 B-002，可能要回头重构 skill 的作用域。**建议 B-002 先行**。
- **与 B-003 独立**：skill 是"增强 agent 能力"的横切机制，subAgent 是"拆分任务"的纵切机制，两条线正交；都做了可以组合，先做哪条不影响。
- **复用现有基础设施**：`QwenEmbeddingProvider`、`DexieMemoryStore` 的向量能力、`RelevantMemorySource` 的 priority 设计范式都是现成的，属于**技术上的好底子**（但 PM 视角不决策，交由 tech lead 判断）。
- 与 ROADMAP · §1 "域名级 DSL 自学习文章提取器" **哲学同源**——都是"LLM 产出可索引的结构化配置，运行时按需激活"。未来二者可以共享一套"结构化扩展点"抽象。

---

## B-005 · 引用标签（Ref Chip）在气泡中的可视化与富媒体扩展

### 背景 / 动机

- 用户原话：**"目前聊天气泡虽然用了 markdown 渲染，但是对于划词引用的内容，在输入框正常，但是在气泡中就不正常了，只是作为纯文本展示。这里我希望能够定义一些类似于索引标签的概念，既可以表示文本，后续也可以拓展图片等信息。"**
- 问题根因方向（PM 视角的初步核查，不做技术方案）：
  - **输入框侧**：划词引用当前是 Lexical 自定义的 `ReferenceNode`（`packages/ui/src/editor/nodes/ReferenceNode.ts`），带结构化 payload（`id / text / source.url`），由 `ReferenceTag` 组件渲染为浅紫 chip。**富媒体扩展位**已经事实上被 payload 预留，但目前只承载文本。
  - **提交链路**：`serializer.ts` 把 chip 拍扁成 `<ref id="..." url="...">text</ref>` 这种**伪 HTML 字符串**，作为 `userInput` 一并发给 LLM；同时在 `referenceTagSource`（priority 70）把引用原文作为独立 system 段再塞一次。
  - **气泡渲染侧**：`MessageBubble` 走 `react-markdown` + `remark-gfm` + **`rehype-sanitize` 默认白名单**。`<ref>` 既不在 GFM 语义里，也不在 sanitize 白名单里，于是会被当作未知标签**降级为纯文本**——这就是"输入框好看、气泡里变纯文本"的直接原因。
  - **历史消息侧**：一旦消息落盘（ChatHistory），当前存的也就是这串 `<ref>` 文本；任何新方案都必须保证**历史消息反序列化后仍能还原为可视化 chip**，不能出现"新版本上线前的老消息永远变回纯文本"的体验断层。
- 本条需求的本质：**把"引用"从"LLM 消费用的序列化字符串"升级为"前端也能识别并可视化的一等对象"**，并为后续的图片 / 截图 / 页面元素快照等富媒体引用预留扩展位。
- 候选命名（**产品层候选名，最终以 developer 实现时定为准**）：
  - `ContentRef` — 强调"对某段/某块内容的引用"，与未来扩展图片、片段、DOM 快照都契合。
  - `InlineRef` — 强调"嵌在对话行内的标签"，与 chip 视觉更贴近，但隐含"只做行内"，扩展到附件型富媒体时语义偏窄。
  - `QuoteChip` — 强调"引用 + chip 视觉"，直观好懂，但"Quote"偏向文本语义，后续接入图片会显得拗口。
  - **推荐：`ContentRef`**（作为数据模型名）+ `RefChip`（作为 UI 渲染组件名）。理由：`Content` 覆盖文本/图片/DOM 快照等多态；`Ref` 继承当前代码里 `ReferenceNode` / `<ref>` 的术语连续性；UI 层用 `RefChip` 和既有 `ReferenceTag` 命名区分新旧两代实现，迁移期不混淆。

### 初步验收标准

- [ ] **视觉一致性**：同一条用户消息里的引用，在输入框（发送前）与气泡（发送后 / 历史回看）**呈现同一套 chip 视觉**（颜色、前缀 @、hover tooltip、截断规则一致），不再降级为纯文本。
- [ ] **富媒体可扩展**：引用对象的数据模型从"仅文本"升级为可承载多种 `kind` 的判别联合（至少预留 `text` / `image`，schema 上留位给 `dom-snapshot` / `pdf-region` 等），新增一种 kind **不需要改 ChatChunk 契约、不需要改 Provider 层**。
- [ ] **文本型引用 MVP**：`kind: 'text'` 的引用在气泡中完整可用（chip 展示 + hover 查看完整原文 + 点击跳回原页面锚点，若锚点信息存在）。
- [ ] **图片型引用占位**：`kind: 'image'` 至少有一条端到端的 happy path（哪怕来源只是"用户在配置页手贴一张图"），证明富媒体扩展不是 PPT；图片在气泡中以缩略 chip + 点击放大的形式呈现。MVP 范围内**不要求**划词工具条真的能截图。
- [ ] **历史消息反序列化**：历史会话（IDB 里已存在的含 `<ref>` 字符串的老消息）**不被破坏**——要么就地升级为新模型，要么兼容渲染，选型由 developer 决定，但 PM 红线是"老会话打开后 chip 该有还得有、不能变纯文本，更不能丢消息"。
- [ ] **Markdown 与引用共存**：同一条消息同时含 markdown（代码块 / 列表 / 链接 / 表格）+ 多个引用 chip 时，两套渲染**不互相破坏**——chip 不会被 sanitize 吃掉、不会打断列表 / 表格结构、不会把后续 markdown 折进 chip 里。
- [ ] **LLM 侧契约不回退**：LLM 看到的 `userInput` 仍然包含可理解的引用语义（`<ref>` 或等价表达），`referenceTagSource` 注入的引用原文段落**继续保持**，不能为了 UI 渲染牺牲 LLM 可读性。
- [ ] **安全红线**：`rehype-sanitize` 白名单不得被无差别放开；新引入的任何自定义元素 / 组件走**显式注册**而非"信任整段 HTML"，与现有"不执行 LLM 输出的脚本"原则一致。
- [ ] **回归覆盖**：在 `serializer.test.ts` / `MessageBubble` 相关测试里新增"含 ref 的消息双向往返渲染一致"用例。

### 优先级建议

**P1**。

理由：
1. **这是一条"可见 bug"**——用户原话里明确指出"气泡里变纯文本"，这属于**既有功能的体验断层**，而不是新功能；不修在任何对外版本里都会被一眼看出来。
2. **同时是"可扩展性铺路"**——图片 / DOM 快照 / PDF 片段等富媒体引用，是后续"阅读助手"向"多模态阅读助手"演进的**必经基础**。现在把数据模型和渲染管线一次性做对，比日后每加一种媒体就重构一次 UI 层便宜得多。
3. **不阻塞其它 backlog**——与 B-002 / B-003 / B-004 正交，可与任何一条并行推进；但如果先做 B-002（多智能体 / 多预置模板），大概率会触发"各种智能体的消息都带引用"的扩散，届时再修成本更高。
4. 与 B-001（DeepSeek 接入）相比仍然后一档——B-001 是"不做就有用户进不来"，B-005 是"不做会被现有用户抱怨"，量级不同；因此在 **P0 < B-005 ≤ P1**，定 P1。

### 可能的依赖关系

- **与 Provider / ChatChunk 契约**：**弱耦合**。引用是"用户侧附加输入" + "前端侧结构化渲染"的问题，LLM 看到的仍是序列化字符串；Provider 层 / 流式 chunk 契约**理论上不需要改动**。这条需要在 developer 评审时显式确认。
- **与 B-002（自定义智能体）**：正交。但**建议 B-005 先于 B-002 或同期落地**，原因见"优先级建议 §3"。
- **与 B-003（subAgent）**：正交。子 agent 的输出若也想引用原文片段，可复用本条沉淀出的 `ContentRef` 模型；**弱协同**。
- **与 B-004（Skills）**：正交。但若未来 skill 的"命中徽章"也想走 chip 视觉，可与 `RefChip` 共享底层组件；**弱协同**。
- **与既有 `ReferenceNode` / `referenceTagSource` / `serializer.ts`**：**强耦合**。本条本质是把这三处从"文本专用"泛化到"多 kind 可扩展"，需一并调整，且必须保持历史消息的向后兼容。

---

## B-006 · 记忆审核文案「关于你 / 关于用户」指代歧义

### 背景 / 动机

- 用户原话：**"目前在会话区审核的时候,两种信息一个是关于你,一个是关于用户。对于用户来说,分不清这个'你'是指谁,应该说明是'关于助手'。"**
- 背景补充：当前记忆系统的 Persona 审核/待批准（approval）流程会把候选条目分成两类 —— `subject: 'agent'` 与 `subject: 'user'`。UI 侧目前都沿用了与注入 prompt 对齐的内部话术（`# 关于你（agent）` / `# 关于用户`），但 **prompt 是说给模型听、"你" = agent** 在那里是自洽的；而 **UI 是说给真人用户听、"你" = 用户** 才符合日常直觉。两处人称坐标系不一致，导致审核界面上的"关于你"被用户误读为"关于我自己"。
- 核查到的现状（面向用户的 UI 文案，共 2 处；内部 prompt / 徽章术语另有若干处，见下）：

  **面向用户的 UI 文案（本 bug 的修改范围）**

  | 文件 | 行 | 当前文案 | 说明 |
  | --- | --- | --- | --- |
  | `packages/ui/src/components/PersonaReviewBanner.tsx` | 211 | `metaParts.push(\`关于你 ${agentCount}\`)` | sidebar 顶部"Persona 待审核"折叠条的 meta 摘要 |
  | `packages/ui/src/components/PersonaReviewBanner.tsx` | 212 | `metaParts.push(\`关于用户 ${userCount}\`)` | 同上 |
  | `packages/ui/src/components/PersonaReviewBanner.tsx` | 232 | `p.subject === 'agent' ? '[关于你]' : '[关于用户]'` | 每条 candidate 前的 subject 徽章 |
  | `packages/ui/src/features/options/tabs/MemoryBrowserTab.tsx` | 384 | `label: \`关于你（agent · ${agentPersonas.length}）\`` | 记忆浏览器 Tab 的 "agent" 分页 label |
  | `packages/ui/src/features/options/tabs/MemoryBrowserTab.tsx` | 396 | `label: \`关于用户（user · ${userPersonas.length}）\`` | 记忆浏览器 Tab 的 "user" 分页 label |
  | `packages/ui/src/components/PersonaReviewBanner.tsx` | 6（注释） | `banner 用 [关于你] / [关于用户] 徽章` | 组件注释随文案同步更新 |

  **不在本 bug 修改范围内（但记录备查）**

  - `packages/agent/src/context/persona.ts` 第 75 / 82 行：`# 关于你（agent）` / `# 关于用户` —— 这是注入给 **LLM** 的 system 段，模型视角的"你" = agent 是正确的，**不改**。
  - `packages/agent/src/__tests__/phase2-sources.test.ts` 第 69–158 行、`docs/requirements/v0.4.0-visible-memory.md` 第 87–110 行、`docs/ROADMAP.md` 第 38 / 196 / 200 行、`docs/CHANGELOG.md` / `docs/v0.2-DESIGN-HISTORY.md` / `docs/v0.4-v0.5-DESIGN-HISTORY.md`：均为**内部设计档案或 prompt 话术对应的测试**，保持现状即可。只有 UI 改版后若引入术语表（glossary），`docs/requirements/v0.4.0-visible-memory.md` 第 101–110 行的验收描述可追加一条"UI 侧改用『关于助手 / 关于你』对称表述"的注脚。
- 没有 i18n：本仓库未引入多语言包（`pnpm` 依赖树里只有 zod 自带的 locales），当前 UI 全部为简体中文硬编码，**本期无需多语言同步**。

### 初步验收标准

- [ ] 所有**面向用户的**记忆审核界面里，原「关于你」文案**统一替换为「关于助手」**（2026-05-06 定稿文案，见下文"已决策文案"一节）。
- [ ] 「关于用户」文案**同步改为「关于你」**，与新方案对称（UI 坐标系下"你" = 用户才符合日常直觉）。
- [ ] 具体改动点（以下两个文件 5 处字符串 + 1 处注释，**统一替换为「关于助手」/「关于你」对**）：
  - `packages/ui/src/components/PersonaReviewBanner.tsx`：L6 注释、L211 meta（`关于助手 ${agentCount}`）、L212 meta（`关于你 ${userCount}`）、L232 徽章三元（`p.subject === 'agent' ? '[关于助手]' : '[关于你]'`）。
  - `packages/ui/src/features/options/tabs/MemoryBrowserTab.tsx`：L384（`关于助手（agent · ...）`）/ L396（`关于你（user · ...）`）Tab label。
- [ ] **不动后端数据模型**：`subject: 'agent' | 'user'` 判别字段、IDB schema、`PersonaSource` 注入话术、反思 Runner 的 parser 全部保持原样；本次只改 UI 字符串。
- [ ] **不动 LLM 侧注入话术**：`packages/agent/src/context/persona.ts` 的 `# 关于你（agent）` / `# 关于用户` 保持现状（模型视角"你" = agent 在那里是自洽的）。
- [ ] **不动已有单测**：`packages/agent/src/__tests__/phase2-sources.test.ts` 里对 `# 关于你` / `# 关于用户` 的断言针对的是 system prompt，不受影响；UI 侧若有快照测试需同步更新。
- [ ] 若后续引入 i18n（目前无），各语言包一并同步更新（本期不涉及）。
- [ ] CHANGELOG 追加一行"UI 文案修正：记忆审核界面『关于你』→『关于助手』、『关于用户』→『关于你』，消除人称指代歧义"。

### 已决策文案（2026-05-06 定稿）

| 维度 | agent 侧文案 | user 侧文案 |
| --- | --- | --- |
| **定稿** | **「关于助手」** | **「关于你」** |

一句话理由：与产品"助手"品牌称谓一致、零技术词、两端长度对称，且 UI 坐标系下"你"自然回到用户的日常指代，彻底消除"这个'你'是指谁"的歧义。

> **历史候选（仅存档，已作废）**：B（「关于 AI」/「关于你」）、C（「关于我（助手）」/「关于你」）。两者在 2026-05-06 评审时被否决，理由分别为"AI 是技术词、与人格化语气冲突"与"『我』在 UI 里容易被再次误读为用户自己、且括号注释啰嗦"。

### 优先级建议

**P1**。

理由：
1. **用户体验 bug**，原话明确指出"分不清这个'你'是指谁"，属于既有功能的可用性问题而非新需求。
2. **改动面极小**（2 个文件、5 处字符串 + 1 处注释；无数据层、无契约层），工时预估 ≤ 30 分钟。
3. **可搭车**：建议在 B-001（DeepSeek）或 B-005（Ref Chip）迭代里顺手做，不单独排期开销更低；但因为修复成本与 B-005 不在一个量级，也可以放在任何一次日常小版本的"随手搭车"清单里。

### 可能的依赖关系

- **独立，无强依赖**。
- 与 B-001 / B-002 / B-005 全部正交。
- 与 `docs/requirements/v0.4.0-visible-memory.md` 的 UI 描述有**文档弱耦合**：如果本条落地，建议顺手在该需求文档里追加一条注脚"UI 侧已在 v0.x.x 修正为『关于助手 / 关于你』"，以免后续维护者对照时困惑。

---

## B-007 · Persona 记忆系统质量:抽取边界 + 整合工具 + 模型可切换

### 背景 / 动机

- **用户原话**（原文保留）：
  > "这里需要新增我觉得体验很不好的地方。目前我在使用的过程中，可能我并不需要 doc-assistant 记住一些 persona 记忆，但是它依然会弹出进行审核，很多内容是跟技能相关的而非跟个人性格相关的。比如它会问：'给用户介绍 go 函数的时候要注意顺序'这种完全不属于一种个人性格、个人信息、个人方式的记忆，就不应该被加入 persona 之中，更不应该还丢给用户审核。"
  >
  > "第二，目前的 persona 记忆只会选取 top-k 来加入，这就导致了可能有记忆加入不了。应该要给对应的模型提供相应的工具，让其整合 persona 记忆，例如重复的可以合并。同样的，当每次要新增一条的时候，也应该看看当前是否已经有了相似的记忆。"
  >
  > "第三，这里如果是大模型能力不够，就考虑换更强的大模型。"

- **代码现状核查**（引用具体文件 / 行 / prompt 要害段落）：

  1. **抽取阶段 prompt · `packages/agent/src/reflection/runner.ts` L236–L263**（`runPersonaExtraction` 方法）
     - 当前 system prompt **有写 subject 的 agent/user 分法**（"这是在定义谁"），**但在"不该记什么"这侧只有一句泛泛收尾**（L256）：
       > "忽略一次性的提问、情绪化表达、只在本次页面有效的事务（那是 working memory 的事）。"
     - **缺失的"反例 / 负边界"显式声明**：什么是"**技能 / 工作流 / 领域知识 / 具体教学指令**"——这些都**不该进 persona**；当前 prompt 里没有把这一圈"非 persona"内容列明。
     - 结果：aux 模型容易把"介绍 go 函数要注意顺序"这种**面向技能的行为约束**误判为 `subject='agent'` 的行为方式条目（看起来确实是"agent 该怎么做"）。这是 **子点 A 的根因**。
     - 同样的边界定义缺失也存在于 `packages/tools/src/definitions/remember-persona.ts` L52（主 LLM 工具 description）—— **两处 prompt 需要共享同一份"persona 边界定义"**，否则主 LLM 和反思 LLM 判断口径会漂移。

  2. **审核队列入口 · `packages/agent/src/reflection/runner.ts` L297–L312**（`addPersonaCandidate` 调用点）
     - **事实确认：所有抽取出来的、通过 dedupe 的 candidate 都会直接以 `status: 'pending'` 落库**（L300），之后由 `PersonaReviewBanner` / `MemoryBrowserTab` 浮现给用户审核。
     - **中间没有任何"该不该记"的闸门**——抽取器产出什么，就丢什么到审核队列。用户吐槽的"弹出审核的很多根本不是 persona"直接对应到这一层：**噪音没有被拦在用户审核之前**。

  3. **检索阶段 top-k 截断 · `packages/agent/src/context/persona.ts` L38–L68**（`createPersonaSource`）
     - **事实确认：确实按 `agentTopK=10` / `userTopK=8` 硬截断**（L38–L39、L64、L68），排序键是 `confidence DESC, updatedAt DESC`（L58–L59）。
     - 一旦用户审核通过的 persona 数量超过这个阈值，**置信度/时间排序之外的长尾 persona 永远进不了 prompt**——即使它们是正确的、被审核通过的。这是 **子点 B 的事实基础**。
     - 现在**没有任何记忆自整理机制**：既没有"新增前查重/查相似"（`runPersonaExtraction` 的 dedupe 是**严格 `content` 字符串相等 + subject 相等**，见 L285–L287，相似但措辞不同的条目会并存），也没有"合并重复/相似 persona"的批处理 tool。

  4. **模型调用点 · `packages/agent/src/reflection/runner.ts` L265 + 依赖注入（`aux`）**
     - `runPersonaExtraction` 用的是**辅助 LLM（`aux`）**，由 `ReflectionRunnerDeps.aux` 传入。全项目 `aux` 当前只被一份 Provider 配置（`auxiliary`）装配，**所有辅助任务共用同一个模型**——无法单独为"persona 抽取 / 整合 / 相似度判断"这一类**对判别力要求更高**的任务指定更强的模型。子点 C 的改动面落在 **ReflectionRunner 及其装配点的模型配置粒度**。

- **这三个子点本质上不是三个独立 bug，而是同一条"Persona 记忆系统质量"链路的三级失控**：
  - **A**（抽取噪音）→ **B**（检索端长尾被截断 + 无整合）→ **C**（底层判别能力不足时无处升级）
  - 不修 A：审核队列噪音继续打扰用户，信任崩溃；
  - 不修 B：即使修了 A 让噪音少了，长期积累下长尾 persona 依然进不了 prompt——**用户审核通过了却"没用"**，是更深的信任问题；
  - 不修 C：前两条的天花板被"aux 模型判别力"锁死，改 prompt 也收益有限。

### 问题拆解（A / B / C 三个子点）

#### 子点 A · 抽取阶段缺"非 persona 边界"定义

- **根因**：prompt 里只写了"persona 是什么"（正例），没写"persona **不是**什么"（反例）；面向**技能 / 工作流 / 领域知识 / 教学指令**类内容缺显式排除。
- **表现**：
  - aux 模型把"介绍 go 函数要注意顺序"这种**面向技能的行为约束**判入 `subject='agent'` 的"行为方式"一类。
  - 类似的误判大概率还有："写代码要先写注释"（工作流）、"介绍 React hook 要按官方文档顺序"（领域教学）、"回答问题要先给代码示例再给解释"（严格来说介于风格与技能之间，边界模糊）。
- **影响**：这些噪音直达审核队列，造成**每次审核都要拒掉一堆不该进来的**，审核成本 ≈ 直接放弃审核 → persona 系统失去把关意义。
- **附带**：主 LLM 的 `remember_persona` tool description（`packages/tools/src/definitions/remember-persona.ts` L52）也需要同步加"非 persona"反例，否则主 LLM 可能绕过反思链路直接写入 `confirmed` 级别的噪音（比 pending 更难清理）。

#### 子点 B · 检索阶段 top-k 截断 + 缺"记忆自整理"工具

- **根因 1（截断）**：`PersonaSource` 的 `agentTopK=10 / userTopK=8` 是**产品红线级别的硬上限**（上下文预算 + 注入段可读性），简单提高 k 会打爆 prompt、并把低置信度噪音也带进来。
- **根因 2（无整合）**：dedupe 只做**严格字符串相等**，相似但措辞不同的条目（例："你说话要简洁" vs "回答保持简洁、不加客套"）会各占一条 slot，加剧 top-k 挤压。
- **真正的解法方向**（产品视角，不做技术方案）：
  - **写入侧 · 新增前相似度检查**：写入 `addPersonaCandidate` 之前先在 **同 subject 范围内** 做向量/语义相似度检索（≥ 阈值触发"合并 / 跳过"建议），避免新增即冗余。
  - **写入侧 · 合并批处理 tool**：提供一个给**反思 Job 或配置页操作**使用的"persona 合并"能力——把相似条目整合为一条（合并后保留合并来源 ID 链路，便于回溯），**降数量而不是提 k**。
  - **读取侧**：短期保持 top-k 不动；通过"整合降数量"让长尾被"语义归并"到头部条目里，自然进入 prompt。
- **不追求的**：无脑提高 topK、或改用 embedding 召回 persona（persona 不是"情景相关"记忆,是"始终在场"的定义,全量注入但降数量才是产品正解）。

#### 子点 C · Persona 相关调用支持独立模型

- **根因**：当前 `aux` 一把抓了"SessionTopic / Intent 精判 / 反思摘要 / Persona 抽取"等所有辅助任务，配置粒度一刀切。
- **解法方向**：让 persona 相关的三类调用（抽取 / 整合相似度判断 / 合并建议）可单独指定 Provider 配置，不与主对话、也不与其它 aux 任务强绑。
- **和 B-001 的关系**：B-001 落地后，DeepSeek R1（推理型）是跑 persona 抽取/整合的**性价比最优解**；但本条**不强依赖 B-001**——即使 B-001 未落地，也可以让用户把 persona 专用模型指到比 `auxiliary` 更强的 Qwen-max 或其它模型。

### 初步验收标准（按子点组织）

#### B-007-A · 抽取边界显式化

- [ ] `packages/agent/src/reflection/runner.ts` 的 `runPersonaExtraction` system prompt（L236–L263）**新增"非 persona"显式反例段落**，至少覆盖：
  - 技能 / 领域知识类（"介绍 go 函数要注意顺序"、"讲 React 要先讲 hook 再讲状态管理"）
  - 工作流 / 做事步骤类（"写代码先写测试"、"审阅文档先看目录"）
  - 一次性教学指令 / 具体任务指令类（"把这段翻译成英文"、"帮我总结这篇文章"）
  - 对页面内容的评价 / 情绪表达（当前 prompt 已隐含,但缺显式反例）
- [ ] `packages/tools/src/definitions/remember-persona.ts` 的 tool description（L52）**同步加同一份反例**,保持主 LLM 判断口径与反思链路一致。
- [ ] 新增 ≥ 1 组离线回归 fixture（放在 `packages/agent/src/__tests__/` 下）：
  - 输入一批"典型技能/工作流/领域知识类语料" + "典型 persona 类语料"
  - 断言：技能/工作流类的**召回率 ≤ 设定上限**（例如 ≤ 10%）；persona 类的**保持召回率 ≥ 下限**（例如 ≥ 80%）
  - 用例覆盖 agent 侧和 user 侧两类
- [ ] **红线**：不收窄 `PersonaSubject` 类型（仍是 `'agent' | 'user'`）;不改动已审核通过的老 persona 数据;只影响**新一轮抽取**的判断口径。
- [ ] 文档同步：`docs/requirements/v0.4.0-visible-memory.md` 追加一条注脚指向 B-007-A 定版的"persona 边界"段落。

#### B-007-B · 记忆自整理工具

- [ ] **新增前相似度检查**：`addPersonaCandidate`（`packages/memory/src/db/dexie-store.ts` 与 `packages/agent/src/reflection/runner.ts` L297–L312 调用点）在落 pending 前,先在**同 subject 范围内**做相似度检索;若相似度 ≥ 阈值,触发以下二选一策略（最终产品选型待用户拍板,见"待拍板问题"）：
  - 策略 ①:直接 merge（把新 candidate 的 `hitCount / tags` 合并到旧条目,confidence 取 max,不产生新 pending）
  - 策略 ②:生成"合并建议"落到审核队列,让用户选"合并 / 新建 / 丢弃"三选一
- [ ] **合并批处理工具**:提供 `merge_personas(ids[])` 类能力,被以下两处消费：
  - 配置页"记忆浏览器" Tab 的手动操作（多选 → 合并)
  - 反思 Job 的"后台自整理"（定时扫 agent/user 两张表,找出 top-N 相似簇,产出合并建议 → 走审核队列)
- [ ] **合并后的数据血统**:合并后的 PersonaRecord 必须保留"合并来源 ID 列表"（在 `source` 字段或新字段里,由 developer 决定）,以便日后回溯与误合并修复。
- [ ] **相似度阈值产品参数化**:阈值不写死,放在 AgentRuntimeConfig（等 "集中化 AgentRuntimeConfig" 工程治理项落地后统一收口;本期可先在 `PersonaSource` 相邻位置临时 export）。
- [ ] **top-k 不改**:本子点**不**调整 `agentTopK=10 / userTopK=8`;靠"整合降数量"让长尾条目被语义归并进头部,从而进入 prompt。
- [ ] 回归测试：相似条目（同义不同词）的新增触发合并路径、合并后置信度/hitCount 正确累积、审核队列不再重复浮现同义条目。

#### B-007-C · Persona 相关调用支持独立模型

- [ ] `ReflectionRunnerDeps` 的 `aux` 依赖**拆分或扩展**,让 "persona 抽取 / 相似度判断 / 合并建议" 三类调用可以指向一个**独立的 Provider 配置**（例如 `personaProvider?: LLMProvider`,未提供时回退到 `aux`——保持向后兼容）。
- [ ] 配置页"Provider"分组新增一个可选的 `persona` 配置槽（允许为空 = 复用 auxiliary）,与现有 `main / auxiliary / embedding` 并列。
- [ ] 文档同步：README "支持的模型" / ROADMAP · §6 Provider 层抽象章节标注"persona 类任务可独立配置模型"。
- [ ] **不破坏已有配置**:旧用户未设置 `persona` 时行为与现状 100% 等价。
- [ ] 与 B-001 的协同标注：B-001 落地后,推荐用户把 `persona` 槽指向 DeepSeek R1（推理型模型,判别力更强),在 B-001 的 requirement 文档里加一条"推荐配置"注脚。

### 优先级建议

**整体 P0**,内部分三期：

- **B-007-A** · **P0** · 改 prompt + 加反例 fixture,改动面小、立即见效。**紧跟 B-001 之后,甚至可以与 B-001 搭车合入**（B-001 迭代本身就动 Provider 层,顺手改 prompt 开销极低）。
- **B-007-B** · **P1** · 架构改动中等（需要引入"相似度检查 + 合并"链路、可能新增 IDB 字段）,建议放在 B-002（自定义智能体）之后,与 B-004（Skills）相近的窗口做。
- **B-007-C** · **P1** · 改动面介于前两者之间,**弱依赖 B-001 的 Provider 抽象成果**,建议 B-001 稳定一个小版本后紧接着做,能把 B-007-A 的 prompt 边界效果推到更高判别力模型上。

**为什么整体 P0**（和 B-001 平级）：
1. **直接打扰用户**：审核噪音 = 每次打开 sidebar 都能看见的体感 bug,信任损失立即发生。
2. **记忆系统是产品核心资产**：长尾 persona 永远进不了 prompt = 用户审核通过的条目"没用",这等于**把记忆系统的产品承诺打了折扣**。
3. **不修的代价是指数级的**：用户记忆越多,A/B 的问题越严重;现在只有小几十条 persona 修是小工;用户用到几百条才修,合并/整合就是硬仗。

### 可能的依赖关系

- **B-007-A** · **独立**,可单独推进。改动面：2 处 prompt（`reflection/runner.ts` + `tools/.../remember-persona.ts`）+ 1 份 fixture 回归测试。
- **B-007-B** · **独立于 B-004**,但实现思路上"记忆整合"天然是 B-004（Skills）的一个场景——未来如果 B-004 落地,`merge_personas` 这类能力可以注册为"内置 skill"。**本期不等 B-004**,独立先做,避免 B-004 进度拖 B-007-B。
- **B-007-C** · **弱依赖 B-001**。若 B-001 先落地,C 直接受益于 DeepSeek R1;若 B-001 未落地,C 也可以让用户切到"更强的 Qwen 或其它 OpenAI 兼容模型",但成本会高一些。**推荐 C 排在 B-001 之后**。
- **与 B-006 正交**（一个是 UI 文案,一个是抽取/检索 pipeline 质量,互不影响）。
- **与 B-005 正交**（一个是气泡 UI 富媒体,一个是记忆质量,互不影响）。

### 待用户拍板的产品参数（本期未定稿）

1. **相似度合并阈值**：是写死一个值（例如 0.85)、让用户在配置页调、还是按 subject 分别设?（PM 建议：先写死 0.85 做 MVP,放到 AgentRuntimeConfig 后再暴露给高级用户。）
2. **合并操作是否需要用户二次确认**：自动合并 vs 产出"合并建议"落审核队列。（PM 建议：**默认走审核队列**——记忆合并是单向不可逆的信任行为,让用户 pass 一次;后续观察数据可提供"高置信度自动合并"开关。）
3. **是否对存量 persona 做一次"历史整理"**:B-007-B 落地时,要不要对**已有**的相似条目做一次批量整理?（PM 建议：**默认不动老数据**,只对新增链路生效;整理老数据作为"高级用户手动触发"在配置页提供按钮,避免在用户不知情下合并历史记忆。）
4. **B-007-A 的召回率/漏报阈值**:fixture 测试里"技能类 ≤ 10% 召回、persona 类 ≥ 80% 召回"这组数字是否合适?还是先不设硬阈值,只看相对改善?（PM 建议：MVP 阶段不设硬数字 gate,只对比改 prompt 前后的命中分布,定性改善即可;后续如果稳定再加数字门槛。）

---

## B-008 · 开源仓库基础设施

### 背景 / 动机

- 2026-05-06 根目录 `README.md` 已重写为开源项目形态（产品介绍、特性、安装、架构、路线图、贡献、文档索引、License 占位等），但"一个开源仓库该有的琐事"并未完全落地。
- 本条作为**合订收纳项**，汇总开源化过程中仍然悬而未决、但单独拎出来又太碎的杂项，避免散落在 README / Issue 里被遗忘。

### 范围（子项清单）

- **License 选择并落地 `LICENSE` 文件**：README 目前标注"待定，候选 MIT / Apache-2.0"，需由项目所有者拍板后落地。
- **`CONTRIBUTING.md`**：贡献流程、分支策略、提 PR / Issue 的最小模板要求、代码风格约定（指回 ESLint / Prettier / tsc -b）。
- **Issue / PR 模板**：`.github/ISSUE_TEMPLATE/*.yml` + `.github/PULL_REQUEST_TEMPLATE.md`（bug 报告 / 功能请求 / 问题咨询三类起步即可）。
- **截图 / 演示素材**：README 目前用 `<!-- TODO -->` 占位，至少补 5 张核心截图（侧边对话框 / 划词引用 / Persona 审核 / 记忆浏览器 / 配置页）放到 `docs/assets/` 或 `docs/images/`。
- **CI 与徽章真实化**：README 顶部徽章现为占位（`license=TBD` 等），待 CI（lint / typecheck / test）与真实版本号 / License 落地后替换为 shields.io 真实数据源。
- **行为准则（Code of Conduct）**：可选，社区规模起来后再补（推荐 Contributor Covenant）。

### 初步验收标准

- [ ] 根目录存在 `LICENSE` 文件，内容与 README "License" 一节对齐。
- [ ] 根目录存在 `CONTRIBUTING.md`，README 的"贡献"一节链接到它。
- [ ] `.github/ISSUE_TEMPLATE/` 与 `.github/PULL_REQUEST_TEMPLATE.md` 就位。
- [ ] `docs/assets/` 或 `docs/images/` 下至少 5 张核心截图，README 替换 `<!-- TODO -->` 占位。
- [ ] README 顶部徽章全部替换为真实数据源（License / Version / CI / PRs Welcome）。

### 优先级建议

**P2 · 未排期**。理由：这些项目**都不影响功能可用性**，属于"开源发布打磨期"任务；建议在首个公开 Release 前分批次收尾，不单独占主迭代槽。可由维护者在任意小版本里随手合入。

### 可能的依赖关系

- 独立。与 B-001 ~ B-007 全部正交。
- License 的选择是**唯一需要项目所有者决策**的硬前置，其它子项都可以先于 License 推进（但 License 不定版前不建议正式打 Release tag）。

---

## B-009 · 给 LLM 增加 Web 能力（WebFetch / WebSearch · 待调研）

### 背景 / 动机

- **用户原话**（原文保留）：
  > "目前 LLM 不支持自己执行网络请求，我们后续需要补充一个 tool 用于获取网络数据。目前没有很好的思路，这个可能要参考一下优秀的开源项目，或者参照 claude-code 的实现来做到。"

- **价值场景**（一两句话说清）：
  - **主动拉 URL**：用户在对话里贴一个链接让 LLM 总结 / 对比 / 提取信息——目前 LLM 只能看当前页面（`read_page_content`），无法跨页访问。
  - **联网检索**：用户问"最近一周 xxx 有什么进展"，LLM 需要走搜索引擎而不是凭 knowledge cutoff 硬答。
  - **突破训练数据截止**：对时效性强的问题（新闻 / 新版本文档 / 股价汇率等）提供现场依据，避免幻觉。

- **核查到的工具体系现状**（给 B-009 的"衔接点"一个具体落脚）：
  - tool 定义统一在 `packages/tools/src/definitions/`，当前注册了 **6 大类 / 共 13 个 tool**：
    1. 页面类 3 个：`read_page_content` / `get_page_identity` / `get_selection_text`
    2. WorkingMemory 细粒度 7 个（由 `buildWorkingMemoryTools` 动态注入)
    3. `remember_persona`
    4. （可选）`recall_memory` · 需 `recallSemantic` dep
    5. （可选）`list_recent_visits` · 需 `listRecentVisits` dep
  - 注册入口 `buildDefaultTools(deps: DefaultToolsDeps)`（`definitions/index.ts` L55–L79)：按 deps 能力动态注入;**可选 tool 靠"deps 里有没有对应执行器"做开关**,这套"依赖注入 + 条件注册"模式将是 B-009 的直接衔接范式（`webFetch?` / `webSearch?` 可选 dep 落地不加代码分叉）。
  - **现有代码里 `fetch(` 调用只出现在 `packages/provider/src/qwen/embedding.ts` 与 `list-models.ts` 两处**——都是 Provider 层对外调 LLM API 的内部 HTTP 调用,**没有任何"供 LLM 使用的通用 HTTP / 网络抓取"基础设施**。意味着 B-009 是**从零开工**,没有可复用的 fetcher。
  - **manifest MV3 / host_permissions 现状**：`apps/extension/manifest.json` 是 MV3、`host_permissions: ["<all_urls>"]`(v0.4.0 起为支持任意 LLM baseURL 放开）。**这个事实对 B-009 很关键**：CORS / 跨域层面,扩展侧实际上已经有"去任意 host 发 fetch"的权限口子,不需要新一轮权限申请审批,但这也把"LLM 驱动的任意 URL 请求"的安全风险直接暴露出来——详见下文 Open Question #4。

### 问题拆解（两子项)

#### B-009-a · WebFetch 类

- **形态**：给定 URL,tool 拉取内容（HTML / JSON / 纯文本),清洗后交给 LLM。
- **对标**：Claude Code 的 `WebFetch`（15 分钟自清缓存 + 本地转 markdown + 小模型二次抽取)、LangChain 的 `WebBrowser` tool、browser-use 的 fetch layer。
- **为什么先做它**：入参单一（一个 URL),出参范式清晰（一段可喂给 LLM 的文本/markdown),**比 b 更基础、更独立**,可以先于搜索能力上线。

#### B-009-b · WebSearch 类

- **形态**：给定 query,tool 返回一批搜索结果条目（title + url + snippet),供 LLM 决定再 WebFetch 哪一条。
- **迭代式搜索特性(2026-05-06 补录 · 用户架构性洞察)**:WebSearch 不是"搜一次返回 N 条结果"的一次性 tool,而是需要**迭代式**执行 —— **搜索 → 拉取(WebFetch)→ 判断相关性 → 不够则换关键词再搜 / 深入某个链接 / 跳转二级页面 → 直到产出带引用的答案**。这正是 **Claude / Perplexity / OpenAI Deep Research** 的做法,其本质需要一个**独立上下文、能自循环、不污染主对话**的子 agent 在后台跑 —— 因此 B-009-b **强依赖 B-003 subAgent**(见下文"依赖关系"小节)。没有 subAgent,B-009-b 只能退化成"搜一次返回列表"的弱版,价值骨折。
- **对标**：Claude WebSearch、Perplexity、OpenAI Deep Research、ChatGPT browsing、Tavily / Serper / Brave Search API,以及 SearxNG（自托管)。
- **依赖 B-009-a**：拿到搜索结果后,"进一步拉详情"这步本质就是 WebFetch。**b 只做得好 = a 先做好**。
- **浏览器扩展的独特优势(待调研)**：能否"复用用户已登录/已开启的搜索引擎 Tab"模拟搜索,跳过第三方 API Key —— 这是 CLI 类 agent 做不到、扩展侧独有的路径。

### 关键未决问题（Open Questions · 入档重点)

> 这条需求用户自陈"没思路",因此 **本期的产出不是方案,而是把必须回答的问题显式列出来,推进"调研"而不是"实装"**。

1. **执行位置（MV3 架构下)**：tool 的 fetch 在哪一层跑?
   - background / service worker?（MV3 下 SW 会被杀,大请求有生命周期风险)
   - offscreen document?（项目已用 offscreen 跑统一记忆 IDB,复用它跑 fetch 需评估）
   - content script?（有页面上下文但会被页面 CSP 限制)
   - **CORS/权限**：`host_permissions: ["<all_urls>"]` 已经开,但这里要评估"LLM 驱动的任意 URL 是否都应该走这个口子",还是**应该另起一层"LLM 发起的 fetch" 白名单**。

2. **内容提取策略（token 经济)**：原始 HTML 塞进 LLM 会爆 token。
   - 要不要复用 ROADMAP v0.6 的 **域名级 DSL 自学习文章提取器**(若届时已有,是天然的内容清洗层）？
   - 没有 DSL 时走 fallback：Readability.js / Turndown（HTML → markdown)/ 辅 LLM 二次摘要？
   - 同一 URL 的原文要不要存一份到 IDB 做二次召回？

3. **搜索能力（B-009-b）走哪条路径**：三选一或并存
   - ① 直接接搜索引擎 API（Google Custom Search / Bing / Brave Search / Tavily / Serper）—— 用户掏 API key
   - ② 爬搜索引擎结果页（法律/反爬/稳定性都不友好，不推荐）
   - ③ **复用用户浏览器里已开的搜索引擎**（扩展独有优势，需模拟用户操作）
   - 选型会直接决定 UI（"要不要在配置页加搜索引擎 API key 槽"）

3.5. **迭代深度 / 终止条件(2026-05-06 补录,仅登记不拍板)**:B-009-b 是迭代式搜索(见"B-009-b 类"小节的架构洞察),子 agent 的**搜索循环如何终止**?候选维度:
   - **最大迭代次数**(硬上限,例如 ≤ 5 轮"搜 → 拉 → 判 → 再搜")
   - **Token 预算**(子 agent 独立 token 预算耗尽即终止,与 B-003 subAgent 的 token 预算隔离红线天然对齐)
   - **相关性阈值**(当前已拉取的证据相关性得分超过阈值就收敛)
   - **无增益收敛**(连续 N 轮未引入新信息 / 新关键词就停)
   - **用户中断**(UI 侧"停止"按钮)
   - 这条**不在本期拍板**,留待 B-003 subAgent 落地后,结合其 maxTurn / token 预算机制一起定;登记为 B-009-b 实装前必答项。

4. **安全与滥用（高优先,需单列一个调研子课题）**：
   - LLM 被 prompt injection 驱动去请求 `http://169.254.169.254/`（云元数据）/ `file://` / `chrome://` / 内网 IP 段时必须拒绝——需要一层**"scheme + 目标 IP 段"硬白名单**。
   - 是否需要**用户二次确认**才能发起第一次对某域名的请求？（类似 Claude Code `WebFetch` 首次访问域名时的 allowlist 确认机制）
   - 请求体里是否可能泄露 cookie / Authorization 头？（默认应该是**无 cookie、无自动鉴权的干净请求**）
   - **决策（2026-05-06）**：用户认为浏览器沙箱环境权限有限,prompt-injection 风险不是 MVP 阻塞项,不投入额外防护成本。scheme / 内网 IP 段的硬白名单与默认干净请求仍保留(这是成本极低的底线防线);但**不再围绕 prompt-injection 新增专门的用户确认流程、审计日志、LLM 输出二次过滤等额外护栏**。残余风险 3 条已在下方「已知并接受的残余风险」登记在案。

5. **缓存策略**：同一 URL 短时间重复拉取是否走缓存？
   - Claude `WebFetch` 用 **15 分钟自清缓存**,值得借鉴。
   - 扩展侧可以存 IDB,但要注意隐私（见上条——被拉过的 URL 属于用户浏览足迹）。

6. **流式 vs 非流式**：大页面的"拉取 + 摘要"是一次性返回,还是流式?
   - 一次性：简单,但 LLM 要等整页拉完。
   - 流式：复杂,但能让 LLM 在"看见关键段落"后提前停止/决策。
   - MVP 建议一次性,流式放到 post-MVP。

### 已知并接受的残余风险（2026-05-06 登记)

> 配合上文 Open Question #4 的用户决策:"浏览器沙箱权限有限,prompt-injection 不是 MVP 阻塞项"。沙箱**挡住了**命令执行 / 本地读文件这一层,但以下 3 条是**浏览器扩展这个宿主环境特有的残余风险,沙箱挡不住**。PM 在此登记,不作为 MVP 阻塞项、不主动追加护栏;一旦未来发生具体安全事件,本登记即为复盘起点。

1. **跨 tab 数据读取 / 外泄**：扩展持 `host_permissions: ["<all_urls>"]`,被注入的 prompt 可诱导 LLM 调用 WebFetch 去请求攻击者控制的 URL,并在 query string / request body 里夹带当前页面的敏感内容(邮箱、登录态反射出的内容、私密页面文本等)。**沙箱不阻止出站 HTTP,也不阻止参数拼接**,此条是本项目安全面的最大外泄通道。
2. **API key 被外发**：扩展持有用户配置的 LLM API key(OpenAI / DeepSeek / Qwen 等)。常规路径下 tool 拿不到 key,但如果 WebFetch 实现不当(例如把完整 request config、headers、或 Provider 内部状态暴露进 tool 上下文),存在被 prompt 诱导回显 / 外发的可能。**实装阶段需明确:WebFetch 的参数面只应是 URL + 可选的 method / body,绝不透传 Provider 侧凭证**。
3. **记忆污染**:LLM 被诱导往 persona / workingMemory 写入错误或恶意内容,这些污染随记忆系统跨会话持续影响用户(与网络无关,但 prompt injection 可触发)。现有 persona 审核队列是默认缓冲,**在审核引入静默通过 / 自整理之前**(参见 B-007-B),此风险保持在"用户可见、可删除、但存在窗口期"的状态。

**处置姿态**:上述 3 条**已知并接受**,MVP 不单独立项防护;Open Question #4 中"首次访问域名用户二次确认"依据用户决策**默认关闭**,以降低打扰。scheme / 内网 IP 段硬白名单 + 默认干净请求(无 cookie、无 Authorization)作为低成本底线保留。

### 对标调研清单（把"参考优秀开源项目"落成具体起点)

> 用户明确提到"参考优秀的开源项目 / claude-code",这里列一份具体清单作为调研起点。**不要全看一遍**,工时会炸;PM 推荐**先研究 2–3 个**(见文末"调研优先级")。

- **CLI 类 agent（和本项目差异最大,但思路最成熟）**：
  - Claude Code (CLI) 的 `WebFetch` / `WebSearch` —— 用户原话点名的对标
  - Cursor / Cline 的 web tool 实现
- **浏览器 agent（最接近本项目环境)**：
  - browser-use —— Python 栈,但 fetch 层思路可抄
  - Skyvern —— 同上
- **开源聊天产品(联网搜索部分)**：
  - Open WebUI（内置 WebSearch,多 provider 可切)
  - LobeChat（插件化联网能力)
- **通用 agent 框架的 web tools**：
  - LangChain（`WebBrowser` / `RequestsGetTool` / `SerpAPIWrapper`)
  - LlamaIndex（`SimpleWebPageReader` / `TrafilaturaWebReader`)
- **搜索引擎侧 API / 自托管**：
  - Tavily（专为 LLM 设计,结果已清洗)
  - Serper（Google 结果封装)
  - Brave Search API（隐私友好,价格合理)
  - SearxNG（完全开源自托管,扩展侧天然亲和)

**调研优先级建议（PM 视角,先看这 3 个)**：
1. **Claude Code 的 `WebFetch`** —— 用户点名、CLI 标杆、缓存/allowlist/小模型二次抽取等范式最清晰
2. **Open WebUI 的联网搜索** —— 同样跑在"用户本地 / 非服务端"环境,多 provider 可切的工程决策最接近扩展侧需求
3. **browser-use 或 Skyvern 任一** —— 看"浏览器环境下怎么处理 fetch + CORS + 反爬",验证浏览器扩展的特殊性在业界是怎么被处理的

### 初步验收标准（粗粒度,因为本条本质是"待调研")

- [ ] **产出调研文档**(放在 `docs/requirements/` 或 `docs/research/`,位置由 developer 决定),至少包含：
  - 上述对标项目中**至少 3 个**的做法摘录与优缺点对比
  - 本项目针对上文 6 个 Open Question 的**选型结论**(每条给出"选 X,因为 Y")
  - MVP 范围划定(哪些做、哪些 post-MVP)
- [ ] **B-009-a(WebFetch) MVP 可用**：LLM 可通过 tool 拉指定 URL → 获得清洗后的文本 / markdown,并作为 tool result 进入下一轮推理。
- [ ] **manifest 权限策略明确**：`host_permissions` 是继续"全开"、还是**为 LLM 发起的 fetch 另起一层白名单**,文档里显式记录决策与理由。
- [ ] **基本安全护栏**:
  - 拒绝 `file://` / `chrome://` / `chrome-extension://` / `data://` 等敏感 scheme
  - 拒绝内网 IP 段（`127.0.0.0/8` / `10.0.0.0/8` / `172.16.0.0/12` / `192.168.0.0/16` / `169.254.0.0/16`）
  - 默认不携带 cookie / Authorization 头（干净请求)
- [ ] **基本缓存**：同一 URL 在 N 分钟内的重复请求命中缓存(N 值由调研阶段定,可参考 Claude 的 15 分钟)。
- [ ] **(B-009-b 可选)** 至少打通一个搜索引擎渠道(API 或浏览器模拟),返回结构化结果列表。
- [ ] **新增 ≥ 1 组端到端测试**：覆盖"正常 URL 拉取成功 / 敏感 scheme 被拒 / 内网 IP 被拒 / 缓存命中"四条主干路径。
- [ ] 文档同步：README "支持的工具" 章节、ROADMAP 追加版本条目。

### 优先级建议

**整体 P1**,内部分 a / b 两档：

- **B-009-a · WebFetch** · **P1** · 是 LLM "联网"能力的基础底座,用户真实诉求明确;**应排在 B-003(subAgent) 之前**——理由:subAgent 实装时如果缺 WebFetch,体感会非常差（子 agent 典型场景就是"帮我去拉几个网页比对一下"),晚做会让 B-003 二次失败。
- **B-009-b · WebSearch** · **P2** · **强依赖 B-003 subAgent**(迭代式搜索需独立上下文子 agent,见"B-009-b 类"与"依赖关系"小节);强依赖搜索引擎选型;**排序上紧跟 B-003 之后**(不早于 B-003),用户群中只有一部分人会持续用联网检索(相对 fetch 而言),放远期可接受。

**为什么不到 P0**：
1. 不是"不做就进不来"(现有 `read_page_content` 已经能覆盖"对当前页内容做深度处理")。
2. 用户自陈"没思路",说明这条需求**本期不具备直接动工条件**,必须经历调研 → 选型 → 实装的全流程。强行拉到 P0 会让真实 P0(B-001 / B-007-A) 被挤压。
3. 用户体感上**不如 B-007(persona 审核噪音每次都打扰用户) 和 B-001(没 DeepSeek 直接决定能不能用) 紧迫**。

**为什么 a 高于 B-003,b 低于 B-003**：
- B-003 · subAgent 的典型用法离不开 WebFetch(子 agent 最常干的事之一就是"拉几个网页比对一下"),B-009-a **是 B-003 的隐性上游**;先做 B-009-a 能显著提升 B-003 的体感与验收标准完成度。
- B-009-b · WebSearch 反之 —— 迭代式搜索需要独立上下文的子 agent 才能跑通,**B-003 是 B-009-b 的硬前置**;B-009-b 排序紧跟 B-003 之后。

### 可能的依赖关系

> **2026-05-06 重写**:用户"WebSearch 需要子 agent 迭代访问"的架构性洞察翻转了 a / b 与 B-003 的相对关系 —— a 独立、b **强依赖** B-003。

- **B-009-a(WebFetch)独立可做**:单次 URL 拉取,入参单一,不需要子 agent 回路;**是 B-003 subAgent 的隐性上游**(subAgent 做任何事都可能要 fetch 外部内容)。可先于 B-003 上线。
- **B-009-b(WebSearch)强依赖 B-003 subAgent**:迭代式搜索(搜 → 拉 → 判 → 再搜/深入)本质需要**独立上下文、能自循环、不污染主对话**的子 agent 来执行(Claude / Perplexity / OpenAI Deep Research 的标准范式)。没有 subAgent,B-009-b 只能退化成"搜一次返回列表"的弱版。**结论:B-009-b 的最早可能实施时间不早于 B-003**,本来放"远期"的定位得到进一步确认 —— 现在是**排序上紧跟 B-003 之后**,而不仅仅是泛指的"远期"。
- **B-009-a 与 B-003 互为上下游**:a 是 B-003 的隐性上游(subAgent 需要 WebFetch),B-009-b 是 B-003 的典型应用场景下游。
- **独立于 B-001 / B-002**,可并行推进。
- **与 B-004 Skills 弱协同**：`web_fetch` / `web_search` 未来都可以作为"内置 skill" 出现在 skill registry 里,本期不强绑,但 schema 设计阶段可以考虑兼容。
- **与 ROADMAP v0.6 · 域名级 DSL 自学习文章提取器 强相关**：DSL 提取器落地后是 WebFetch 天然的"HTML 清洗层",B-009 的内容提取环节应**优先复用 v0.6 成果**,避免重复造轮子;若 v0.6 尚未落地,B-009-a 的 MVP 可先用 Readability / Turndown 兜底。
- **与 manifest host_permissions 强耦合**：本条落地可能反向推动 `apps/extension/manifest.json` 的权限策略重审(详见 Open Question #1)。

### 已拍板的产品参数

1. **首次访问某域名是否需要用户确认** · 拍板于 2026-05-06 ·**默认关闭**。结合上文 Open Question #4 的用户决策(浏览器沙箱权限有限,prompt-injection 风险不作为 MVP 阻塞项),为避免每次 WebFetch 弹窗打扰用户,首期**不做首次访问域名确认**;若未来观察到滥用或用户反馈,再考虑以"可信域名白名单"或"命中风险规则时才确认"的方式回补。

### 待用户拍板的产品参数(本期未定稿)

1. **搜索引擎偏好**：Google/Bing API (需 key)、Brave/Tavily (LLM 友好)、SearxNG (自托管)、浏览器模拟 —— 是否已有偏好?PM 建议:调研阶段选 **Tavily + SearxNG 双路径** 对比,前者看"为 LLM 设计"的范式,后者看"自托管零 API key"的工程可行性。
2. **缓存时长**：15 分钟(Claude 标杆) / 更长 / 更短?PM 建议: MVP 跟 Claude 的 15 分钟,后续可参数化。
3. **是否在 MVP 就处理"复杂页面(SPA / JS-heavy)"**：纯 `fetch` 拿不到 SPA 渲染后内容,需要真正的 headless 页或注入脚本 —— 这比想象中大。PM 建议: **MVP 先只支持静态 HTML / JSON**,SPA 页明确标注"不支持,推荐用户手动打开让 `read_page_content` 接管"。

---

## 优先级总论

综合以上九条，PM 视角的**推荐排期顺序**：

1. **B-001 · 接入 DeepSeek（P0）** — 用户覆盖面最广，改动最小，最快见效；同时为后续所有 agent / tool / skill 提供便宜的"辅助算力"。
2. **B-007-A · Persona 抽取边界显式化（P0，搭车项）** — 改 prompt + 加反例 fixture，改动面小（2 处 prompt + 1 份测试)；建议**紧跟 B-001 或与 B-001 搭车合入**；属于用户已报的体感 bug（审核队列噪音），不修会持续打扰用户。
3. **B-006 · 记忆审核文案指代歧义（P1，搭车项）** — 改动面极小（2 个文件、5 处字符串 + 1 处注释），属于可见 UX bug，建议搭车在 B-001 或 B-005 的迭代里顺手合入。
4. **B-005 · 引用标签在气泡中的可视化与富媒体扩展（P1）** — 属于"可见 bug + 可扩展性铺路"，不修会被现有用户一眼看出来；先于 B-002 落地可避免后续多智能体引入后引用场景爆发再返工。
5. **B-002 · 自定义智能体（P1）** — 打下"agent 是一等公民"的基础，是后面几条的必要前置抽象。
6. **B-007-B · Persona 记忆自整理工具（P1）** — 架构改动中等;建议放在 B-002 之后、与 B-004 相近窗口;不等 B-004。
7. **B-007-C · Persona 相关调用支持独立模型（P1）** — 弱依赖 B-001 的 Provider 成果;在 B-001 稳定后紧接着做,把 B-007-A 的 prompt 边界效果跑到更强模型上。
8. **B-004 · Skills（P2）** — 依赖弱 B-002，与 B-003 正交；PM 建议 **先 B-004 再 B-003** 或两者并行。
9. **B-009-a · WebFetch（P1，但本期需先调研）** — 先于 B-003 落地,因为 subAgent 没有 WebFetch 会大打折扣;入档后第一步是产出对标调研文档(Claude Code WebFetch / Open WebUI / browser-use 任一为起点)。
10. **B-003 · subAgent（P2）** — 依赖 B-002；虚线依赖 B-009-a(没有不影响,但有会显著提升体感);**是 B-009-b 的硬前置**(迭代式搜索的基础设施);价值深但受益面较窄，放在中后期做。
11. **B-009-b · WebSearch（P2，紧跟 B-003 之后）** — **强依赖 B-003 subAgent**(迭代式搜索需独立上下文子 agent,Claude / Perplexity / OpenAI Deep Research 范式);强依赖搜索引擎选型;排序上紧跟 B-003,不再仅是泛指的"远期";建议 B-009-a 稳定 + B-003 落地 + 调研定版后再动。

### 依赖关系图（简）

```
B-001 (DeepSeek)  ──── 独立
      │
      ├──(弱协同: 便宜的辅助算力)──┐
      │                            │
      └──(推荐作为 B-007-C 的目标模型) ──→ B-007-C (persona 独立模型槽)
                                   │
B-002 (自定义智能体) ───────────────┼─→ B-003 (subAgent · 强依赖 B-002)
                                   │         ↑
                                   │         └─(隐性上游: subAgent 典型场景依赖 WebFetch)── B-009-a
                                   │         │
                                   │         └──(强依赖: 迭代搜索需独立上下文子 agent)──→ B-009-b
                                   │
                                   └─→ B-004 (Skills · 弱依赖 B-002)
                                          ├─(弱协同: merge_personas 可作内置 skill)──→ B-007-B
                                          └─(弱协同: web_fetch / web_search 可作内置 skill)──→ B-009

B-003 ⟷ B-004：相互独立、可并行，建议先 B-004 再 B-003

B-005 (引用标签 · Ref Chip) ──── 与以上全部正交
      │
      └── 强耦合既有 ReferenceNode / referenceTagSource / serializer.ts
      └── 与 ChatChunk / Provider 契约弱耦合

B-006 (记忆审核文案修正) ──── 与以上全部正交；搭车 B-001 或 B-005 合入即可

B-007 (Persona 记忆系统质量) ── 三子项:
   ├─ B-007-A (抽取边界) ── 独立、P0、改 prompt;搭车 B-001
   ├─ B-007-B (整合工具) ── 独立于 B-004、P1、写入侧相似度 + 合并批处理
   └─ B-007-C (独立模型) ── 弱依赖 B-001、P1、Provider 配置增一槽

B-009 (给 LLM 增加 Web 能力) ── 两子项:
   ├─ B-009-a (WebFetch) ──── P1、B-003 的隐性上游、先于 B-003、与 ROADMAP v0.6 DSL 提取器强相关(内容清洗可复用)
   └─ B-009-b (WebSearch) ── P2、**强依赖 B-003 subAgent**(迭代式搜索需独立上下文子 agent)、排序紧跟 B-003 之后、依赖搜索引擎选型
```

---

## 变更记录

| 日期 | 变更 | 作者 |
| --- | --- | --- |
| 2026-05-06 | 初版创建，收录 B-001 ~ B-004 | PM |
| 2026-05-06 | **B-001 升级为正式需求** → `docs/requirements/v0.5.1-deepseek-provider.md`；索引表状态改为"已立项/待开发" | PM |
| 2026-05-06 | **CheckerAgent 并入 B-002**：采纳治理建议，ROADMAP · §4 / v0.8 不再单独演化，改为基于 B-002 "自定义智能体框架"的内置 `background` 型实例；B-002 验收标准新增"智能体类型 / 触发方式 / 输出通道 / 默认启用开关"四项 schema 承载要求；ROADMAP · §4 与版本表加注脚与交叉链接 | PM |
| 2026-05-07 | **新增 B-005**：引用标签（Ref Chip）在气泡中的可视化与富媒体扩展；定位为"可见 bug + 可扩展性铺路"，优先级 P1，推荐排期紧随 B-001、先于 B-002；产品层候选命名推荐 `ContentRef`（数据模型）+ `RefChip`（UI 组件），最终以 developer 实现时定为准 | PM |
| 2026-05-06 | **新增 B-006**：记忆审核文案「关于你 / 关于用户」指代歧义；核查到 UI 侧 2 个文件共 5 处字符串 + 1 处注释（`PersonaReviewBanner.tsx` L6/L211/L212/L232、`MemoryBrowserTab.tsx` L384/L396）；明确 LLM 注入话术 / 单测 / 后端数据模型**不动**；推荐文案对「关于助手」/「关于你」；优先级 P1，搭车 B-001 或 B-005 合入 | PM |
| 2026-05-06 | **新增根目录 `plan.md`** 作为能力点索引视图（已实现 / 在建 / 未实现 + 优先级 + 来源指针），并给出把 backlog 顺序与 ROADMAP 未来版本合并的一条推进时间线；权威仍在 ROADMAP / backlog / requirements 三处，`plan.md` 只做单页仪表盘 | PM |
| 2026-05-06 | **B-006 文案定稿**：经用户拍板采纳方案 A —— agent 侧「关于助手」、user 侧「关于你」；B-006 节内「候选文案」小节改为「已决策文案」；索引表状态改为"✅ 文案已定稿，待排期搭车实装"；LLM 注入话术 / 后端数据模型 / 单测保持不动 | PM |
| 2026-05-06 | **用户一次性拍板 4 条决策归档**：① DeepSeek R1 `reasoning_content` 采纳 C 方案（新增 `ChatChunk.reasoning` chunk 类型，UI 折叠展示）、② B-006 文案定稿「关于助手」/「关于你」、③ ROADMAP 3 处不一致整同（Chronological Index / manifest 0.6.0-beta.1 / `persona_conflict_check`）、④ 用户暂不开工。仅文档层修订，未动代码 | PM |
| 2026-05-06 | **新增 B-007**：Persona 记忆系统质量(抽取边界 + 整合工具 + 模型可切换);用户反馈"审核队列噪音 + top-k 截断长尾 + 模型能力不足"三连击。核查到根因分别位于 `packages/agent/src/reflection/runner.ts` L236–L263 的抽取 prompt(只有正例、缺非 persona 反例)、`packages/agent/src/context/persona.ts` L38–L68 的 top-k 硬截断 + L285–L287 的严格字符串 dedupe、以及 `ReflectionRunnerDeps.aux` 的模型配置一刀切。内部分 A / B / C 三子项:A(抽取边界) P0 搭车 B-001、B(整合工具) P1 独立、C(独立模型) P1 弱依赖 B-001。索引表与优先级总论更新、依赖关系图重绘、留 4 条待用户拍板产品参数(阈值 / 合并确认 / 存量整理 / 召回率 gate) | PM |
| 2026-05-06 | **重写根目录 `README.md`** 为开源项目形态（产品介绍 / 核心能力 / 架构 / 安装 / 路线图 / 贡献 / 文档索引 / License 占位）；后续待补 `LICENSE` 文件、`CONTRIBUTING.md`、Issue·PR 模板、截图素材、CI 徽章真实化 —— 已汇总为新增 backlog 项 **B-008 · 开源仓库基础设施**（P2，未排期），不擅自创建 `LICENSE` / `CONTRIBUTING.md`，留待项目所有者决策 | PM |
| 2026-05-06 | **新增 B-009 · 给 LLM 增加 Web 能力**（WebFetch / WebSearch · 待调研);用户自陈"没思路",本条入档重点是列齐 6 条 Open Questions(执行位置 / 内容提取 / 搜索路径 / 安全滥用 / 缓存 / 流式) + 具体对标清单(Claude Code / Open WebUI / browser-use / LangChain / Tavily / SearxNG 等)。核查到现有 tool 体系位于 `packages/tools/src/definitions/`、注册范式为 `buildDefaultTools(deps)` 条件注册(已含 13 个 tool),代码里除 Provider 层对接 LLM API 外**没有任何可复用的 fetcher 基础设施**;manifest 为 MV3、`host_permissions: ["<all_urls>"]` 已全开(为 LLM baseURL 而开),B-009 权限策略需显式重审。分两子项:a(WebFetch) P1、b(WebSearch) P2;优先级总论把 **B-009-a 插在 B-004 之后、B-003 之前**(subAgent 的隐性上游),B-009-b 置于末尾远期;依赖图新增 B-003 → B-009-a 虚线依赖、B-009 ↔ B-004(web_fetch 可作内置 skill)弱协同、B-009 ↔ ROADMAP v0.6 DSL 提取器强相关(内容清洗复用)。留 4 条待用户拍板产品参数(首次访问确认 / 搜索引擎偏好 / 缓存时长 / SPA 支持范围) | PM |
| 2026-05-06 | **B-009 prompt-injection 风险决策归档**:用户判断"浏览器沙箱权限有限,prompt-injection 非 MVP 阻塞项,不投入额外防护成本",写入 Open Question #4 决策条;同步把"首次访问某域名是否用户二次确认"从「待拍板」迁入新增「已拍板」小节,**默认关闭**以减少打扰;新增「**已知并接受的残余风险**」小节登记沙箱挡不住的 3 条浏览器扩展特有风险(① 跨 tab 数据外泄 / ② API key 潜在外发 / ③ 记忆污染),措辞中性,作为未来安全事件复盘起点;「待拍板」小节剩余 3 条(搜索引擎偏好 / 缓存时长 / SPA) | PM |
| 2026-05-06 | **B-009-b 迭代搜索特性明确,依赖 B-003 subAgent,排序调整**:用户补录架构性洞察"WebSearch 需要用到 subAgent,可能需要迭代访问网站以获取数据",等同 Claude / Perplexity / OpenAI Deep Research 的**搜 → 拉 → 判 → 再搜/深入**范式。B-009-b 子能力描述追加迭代式搜索说明;依赖关系重写:**B-009-a 独立、是 B-003 隐性上游;B-009-b 强依赖 B-003 subAgent**(迭代搜索需独立上下文子 agent);B-009-a 与 B-003 互为上下游。Open Question 追加 #3.5「迭代深度 / 终止条件」(最大迭代次数 / token 预算 / 相关性阈值 / 无增益收敛 / 用户中断,不在本期拍板,留 B-003 落地后与 maxTurn 机制一起定)。优先级总论 B-009-b 从"远期"明确为"**紧跟 B-003 之后**"(排序不早于 B-003);依赖关系图更新:B-003 ↑ B-009-a(隐性上游)、B-003 → B-009-b(强依赖);B-003 节反向追加"启用下游 B-009-b"说明(B-009-b 是 subAgent 的典型应用场景)。索引表 B-003 与 B-009 行依赖列、建议排期顺序行同步 | PM |
