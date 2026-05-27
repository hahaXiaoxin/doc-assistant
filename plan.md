# Doc Assistant · 能力点总览（plan.md）

> **这份文件是什么**：全项目"已实现 / 在建 / 未实现"能力点的**索引视图 / 单页仪表盘**，服务于快速盘点和排期对齐。
>
> **权威仍在三处**：
> - 版本路线与架构红线 → [`docs/ROADMAP.md`](./docs/ROADMAP.md)
> - 未排期需求池 → [`docs/backlog.md`](./docs/backlog.md)
> - 正式需求说明 → [`docs/requirements/`](./docs/requirements/)
>
> **本文件只做索引 / 不做全文转述**：每条一行、详情点引用指针。
>
> **更新节奏**：每次 ROADMAP / backlog / requirements 变更 → 同步本文件；重大版本发布当天对齐一次。变更记录见文末。
>
> 最近对齐日期：2026-05-06（B-009-b 迭代搜索特性明确 → 强依赖 B-003 subAgent → 排序紧跟 B-003 之后）
>
> **数量统计**（仅供一眼概览，以正文表格为准）：🔲 未实现 **24** 条 · 🚧 在建 **5** 条 · ✅ 已实现 **28** 条 · **总数 57** 条。

---

## 图例

| 图标 | 含义 |
|---|---|
| ✅ | **已实现**：代码已落盘 + ROADMAP 对应版本已发布 |
| 🚧 | **在建 / 部分实现**：代码有雏形，但 ROADMAP 未发版，或只完成一部分验收标准 |
| 🔲 | **未实现**：仅出现在 ROADMAP 未来版本 / backlog / v0.2.5+ 未来方向 |

| 优先级 | 含义 |
|---|---|
| **P0** | 不做会影响核心可用性 / 用户进不来 |
| **P1** | 可见 bug / 差异化关键能力 / 阻塞后续抽象 |
| **P2** | 进阶能力，适用场景偏窄或复杂度高 |
| — | 无明确优先级（延后项 / 内部治理） |

---

## 一、基础对话与 UI

| 状态 | 能力点 | 优先级 | 来源 |
|---|---|---|---|
| ✅ | 页面内文本对话 · Provider/Agent/Tools/UI 四层架构 | — | `ROADMAP v0.1` |
| ✅ | 侧边对话框（Shadow DOM 隔离） | — | `ROADMAP v0.1 / v0.1.1` |
| ✅ | 独立配置页（Tab 分页：基础 / 记忆 / 记忆浏览器 / 高级 / 调试） | — | `ROADMAP v0.2.0 / v0.4.0` |
| ✅ | 划词引用（Lexical `ReferenceNode`） | — | `ROADMAP v0.1` |
| ✅ | 斜杠命令 `/new` `/recall` `/topic` | — | `ROADMAP v0.1 / v0.2.1` |
| ✅ | Markdown 渲染（GFM · 表格 / 任务列表 / 代码高亮 Shiki） | — | `CHANGELOG v1.1 PR-4` |
| ✅ | ThinkingBlock（思考过程折叠） | — | 代码：`packages/ui/src/components/ThinkingBlock.tsx` |
| 🚧 | 引用标签 Ref Chip 在**气泡中**的可视化与富媒体扩展 | **P1** | `backlog B-005` |
| 🔲 | 记忆审核文案「关于你 / 关于用户」指代歧义修正（UI 文案级，改 `PersonaReviewBanner` / `MemoryBrowserTab` 5 处字符串；文案已于 2026-05-06 定稿为「关于助手」/「关于你」） | **P1** | `backlog B-006`（搭车 B-001 / B-005） |
| 🔲 | 完整 Markdown 渲染补全（LaTeX / Mermaid） | — | `ROADMAP §6` |
| 🔲 | 流式响应过程可视化（思考 / 工具 / skills 时间线） | — | `ROADMAP §6` |
| 🔲 | 首次安装引导（antd Tour） | — | `ROADMAP §6` |
| 🔲 | tool-call 可观测性徽章（`已调用 N 个工具`） | — | `ROADMAP v0.2.5+` |
| 🔲 | RecallResultCard 独立样式 | — | `ROADMAP v0.2.5+` |

## 二、Provider · 模型适配

| 状态 | 能力点 | 优先级 | 来源 |
|---|---|---|---|
| ✅ | 三套 Provider 配置（main / auxiliary / embedding） | — | `ROADMAP v0.2.0` |
| ✅ | QwenProvider · 主对话 / 流式 / tool-calling / usage 归一化 | — | `ROADMAP v0.1 / v0.2` |
| ✅ | QwenEmbeddingProvider | — | `ROADMAP v0.2.0` |
| ✅ | host_permissions `<all_urls>`（任意 baseURL 可用） | — | `ROADMAP v0.4.0` |
| 🔲 | 接入 DeepSeek（deepseek-v4-flash / deepseek-v4-pro）· **本期范围扩大**：`reasoning_content` 链路采纳 C 方案（新增 `ChatChunk.reasoning` chunk 类型，UI 折叠展示；v0.6.0-beta.2 起不再绑定特定模型） | **P0** | `backlog B-001` → `requirements/v0.6.0-beta.2-deepseek-provider.md` |
| 🔲 | Provider 层抽象（OpenAI / Anthropic / Ollama） | — | `ROADMAP §6` |

## 三、记忆系统

| 状态 | 能力点 | 优先级 | 来源 |
|---|---|---|---|
| ✅ | DexieMemoryStore + 四层记忆 schema（Persona / Episodic / SessionTopic / WorkingMemory） | — | `ROADMAP v0.2.0` |
| ✅ | PageVisit 生命周期（替代 session） | — | `ROADMAP v0.2.0` |
| ✅ | URL 归一化 + 敏感信息过滤 | — | `ROADMAP v0.2.0` |
| ✅ | 辅助 LLM：SessionTopic 识别 / Intent 精判 | — | `ROADMAP v0.2.1` |
| ✅ | 反思 Job（visit_summary / persona_extraction）+ Scheduler + SW alarm | — | `ROADMAP v0.2.1` |
| ✅ | 召回链路 · RelevantMemorySource（粗判 → aux 精判 → 向量） | — | `ROADMAP v0.2.1` |
| ✅ | WorkingMemory 7 个细粒度 tool + `remember_persona` + `recall_memory` | — | `ROADMAP v0.2.1` |
| ✅ | PersonaReviewBanner（sidebar 折叠条） | — | `ROADMAP v0.2.1` |
| ✅ | Persona 双主体（`subject: 'agent' \| 'user'`） | — | `ROADMAP v0.4.0` · `requirements/v0.4.0` |
| ✅ | Chronological Index · `list_recent_visits` tool + 时间维查询自动路由 | — | `ROADMAP v0.4.0` · `requirements/v0.4.0` |
| ✅ | 记忆浏览器 Tab（`MemoryBrowserTab`） | — | `ROADMAP v0.4.0` |
| ✅ | 话题漂移关键词触发（`TOPIC_DRIFT_PATTERNS`） | — | `ROADMAP v0.4.0` |
| ✅ | 统一记忆 · Offscreen Document 架构（跨域名共用 IDB） | — | `ROADMAP v0.5.0` · `requirements/v0.5.0` |
| ✅ | `RemoteMemoryStore` 消息代理（22 条方法） | — | `ROADMAP v0.5.0` |
| 🚧 | `persona_conflict_check` 反思任务（骨架已落于 `packages/agent/src/reflection/runner.ts`，完整 prompt + 落库逻辑待实装） | — | `ROADMAP v0.2.5+` |
| 🚧 | 话题漂移完整版（相似度阈值 / aux 漂移判定） | — | `ROADMAP v0.2.5+` |
| 🚧 | 召回粗判 `RECALL_PATTERNS` 升级（降漏报） | — | `ROADMAP v0.2.5+` |
| 🚧 | 旧 visit 消息按距离/字数裁剪 | — | `ROADMAP v0.2.5+` |
| 🔲 | PersonaReviewList 配置页批量审核 Tab | — | `ROADMAP v0.2.5+` |
| 🔲 | **B-007-A · Persona 抽取边界显式化**（补"非 persona"反例,覆盖技能/工作流/领域教学类误判;2 处 prompt 同步:`reflection/runner.ts` L236–L263 + `tools/.../remember-persona.ts` L52;加离线回归 fixture） | **P0** | `backlog B-007`(搭车 B-001) |
| 🔲 | **B-007-B · Persona 记忆自整理工具**（新增前相似度检查 + 合并批处理 + 合并血统 + 阈值参数化;top-k 不改,靠整合降数量） | **P1** | `backlog B-007` |
| 🔲 | **B-007-C · Persona 相关调用支持独立模型**（`ReflectionRunnerDeps` 新增 `personaProvider` 可选槽;配置页 Provider 分组新增 `persona` 槽） | **P1** | `backlog B-007`(弱依赖 B-001) |
| 🔲 | `/forget` 命令（真删） | — | `ROADMAP v0.2.5+ / §6` |
| 🔲 | 会话导入 / 导出（JSON） | — | `ROADMAP v0.2.5+` |
| 🔲 | Token 级上下文截断（替代字符估算） | — | `ROADMAP §6` |
| 🔲 | SPA 场景页面摘要过期主动刷新 | — | `ROADMAP §6` |

## 四、Agent · 扩展性

| 状态 | 能力点 | 优先级 | 来源 |
|---|---|---|---|
| ✅ | Agent Loop + 最后一轮纯 A 兜底 | — | `ROADMAP v0.2.0` |
| ✅ | AgentOrchestrator 骨架（`packages/agent/src/orchestrator.ts`） | — | `ROADMAP v0.2.0` |
| 🔲 | 自定义智能体（领域专家） | **P1** | `backlog B-002` |
| 🔲 | subAgent · 子智能体委派 | **P2** | `backlog B-003`（强依赖 B-002；虚线依赖 B-009-a;**启用下游 B-009-b**) |
| 🔲 | Skills · 可索引可调用的技能包 | **P2** | `backlog B-004`（弱依赖 B-002） |
| 🔲 | **B-009-a · WebFetch**(给定 URL 拉取内容并喂给 LLM;MV3 / host_permissions 策略待调研) | **P1** | `backlog B-009`(待调研;先于 B-003) |
| 🔲 | **B-009-b · WebSearch**(给定 query 迭代式搜索 → 拉取 → 判断 → 再搜,产出带引用答案;依赖搜索引擎选型) | **P2** | `backlog B-009`(**强依赖 B-003 subAgent**;紧跟 B-003 之后) |
| 🔲 | CheckerAgent · 实时提醒 | — | `ROADMAP v0.8 / §4`（已并入 B-002 框架） |
| 🔲 | 域名级 DSL 自学习文章提取器 | — | `ROADMAP v0.6 / §1`（B-009 内容清洗层可复用） |
| 🔲 | OCR 策略 + 截图工具 + 多模态识图 | — | `ROADMAP v0.7 / §3` |

## 五、工程 / 可观测性 / 交付

| 状态 | 能力点 | 优先级 | 来源 |
|---|---|---|---|
| ✅ | Sidebar Shadow DOM / finish 语义 / CORS / modulePreload 修复 | — | `ROADMAP v0.1.1` |
| ✅ | 移除 v0.1 兼容代码（Breaking） | — | `ROADMAP v0.3.0` · `requirements/remove-v0.1-compat.md` |
| ✅ | `minimum_chrome_version: 109` | — | `ROADMAP v0.5.0` |
| 🔲 | **Token 用量看板**（按 provider × model × 日期聚合） | 偏高 | `ROADMAP v0.2.5+` |
| 🔲 | **集中化 AgentRuntimeConfig**（prompt / agent 超参共享） | 🟧 中 | `ROADMAP v0.2.5+ · 工程治理` |
| 🔲 | 日志审计页 / 权限使用日志 | — | `ROADMAP §6` |
| 🔲 | 云端同步（自托管 endpoint · E2EE · 手动触发） | — | `ROADMAP v0.9 / §5` |
| 🔲 | **B-008 · 开源仓库基础设施**（LICENSE 落地 / CONTRIBUTING.md / Issue·PR 模板 / 截图素材 / CI 徽章真实化） | **P2** | `backlog B-008` |

---

## 未实现能力的推进顺序（合并时间线）

> 复用 `backlog` 内部顺序 **B-001 → B-007-A → B-006 → B-005 → B-002 → B-007-B → B-007-C → B-004 → B-003**（B-006 / B-007-A 为搭车项），把 ROADMAP 未来版本（v0.6~v0.9）与 v0.2.5+ 的高优先级治理项穿插进来。

```
近期（~1 个月内）
├─ 1. B-001 · 接入 DeepSeek（P0）────────────── v0.5.1（已立项、待开发）
├─ 2. B-007-A · Persona 抽取边界显式化（P0，搭车 B-001）── 改 prompt + 反例 fixture;不单独占槽
├─ 3. B-006 · 记忆审核文案修正（P1，搭车项）──── 5 处字符串 + 1 处注释;搭车 B-001 或 B-005
├─ 4. B-005 · Ref Chip 气泡富媒体（P1）───────── 可见 bug + 可扩展铺路
└─ 5. Token 用量看板（用户反馈优先级偏高）────── 接 B-001 后立刻凸显价值

中期（基础设施 + 平台化）
├─ 6. 集中化 AgentRuntimeConfig（🟧 中）──────── 建议在 v0.6 之前完成,收口 B-007-B 的阈值参数
├─ 7. B-002 · 自定义智能体（P1）────────────── 为 B-003 / B-004 / CheckerAgent 铺底
├─ 8. B-007-B · Persona 记忆自整理工具（P1）──── 写入侧相似度 + 合并批处理;不等 B-004
├─ 9. B-007-C · Persona 独立模型槽（P1）──────── 弱依赖 B-001;把 A 的边界效果推到更强模型
└─ 10. ROADMAP v0.6 · DSL 自学习提取器 ────── §1

远期（进阶能力）
├─ 11. B-004 · Skills（P2）─────────────────── 先于 B-003;merge_personas / web_fetch 未来可作内置 skill
├─ 12. B-009-a · WebFetch（P1,但本期先调研）── 先于 B-003;是 subAgent 的隐性上游;产出调研文档 → 选型 → MVP
├─ 13. B-003 · subAgent（P2）──────────────── 强依赖 B-002;虚线依赖 B-009-a(没有不影响,有会显著提升体感);**是 B-009-b 的硬前置**
├─ 14. B-009-b · WebSearch（P2,B-003 subAgent 交付后）── **强依赖 B-003**(迭代式搜索需独立上下文子 agent,Claude / Perplexity / Deep Research 范式);搜索引擎选型;排序紧跟 B-003
├─ 15. ROADMAP v0.7 · OCR 与多模态 ────────── §3
├─ 16. ROADMAP v0.8 · CheckerAgent 实时提醒 ── 作为 B-002 框架下的 `background` 型内置智能体
└─ 17. ROADMAP v0.9 · 云端同步 E2EE ───────── §5

同步推进 / 随手搭车（工时 ≤ 1h 的）
  · persona_conflict_check 占位转实装
  · 话题漂移完整版（相似度 / aux 漂移判定）
  · 召回粗判 RECALL_PATTERNS 扩词
  · 旧 visit 消息按距离/字数裁剪
  · `/forget` 命令
  · 会话导入 / 导出
```

---

## 维护约定

1. **触发同步更新**的场景：
   - `docs/ROADMAP.md` 版本表 / 验收清单变更
   - `docs/backlog.md` 新增 / 状态变更 / 剪切迁移到 requirements
   - `docs/requirements/` 新增正式需求文档
   - 代码里新落盘了一个能承载"能力点"的模块（例如新加一条 slash 命令、新 ContextSource、新 tool）
2. **同步的颗粒度**：只改状态图标 / 来源指针 / 优先级标签；**不抄全文**。
3. **变更记录必须**：每次同步在文末追加一行，注明日期 + 变更要点。
4. **发现文档 / 代码不一致时**：在变更记录里**点名说明**，不默默修正（这是本文件真正的价值点）。

---

## 附录 A · 本次盘点发现的文档 / 代码不一致

| 项 | 现象 | 处置 |
|---|---|---|
| **Chronological Index** | ROADMAP `v0.2.5+（未来方向，未排期）` 仍把 `list_recent_visits` + 时间维路由列为 🔲 未实现；但 v0.4.0 已发布（代码实装在 `packages/tools/src/definitions/list-recent-visits.ts` + `packages/agent/src/context/time-query.ts`） | ✅ 已处置（2026-05-06）：ROADMAP `v0.2.5+` 小节此条已勾为 `[x]` 并加注脚指向两处代码文件，说明已随 v0.4.0 落地 |
| **manifest 版本号领先** | `apps/extension/manifest.json` 为 `0.6.0-beta.1`；ROADMAP 版本表里 v0.6 仍标"规划中"、v0.5.0 为最近已发布 | 🟧 已登记（2026-05-06）：ROADMAP 版本路线表 v0.6 行已加注脚登记矛盾，**留待 developer / 维护者确认**是发版抢号还是文档未同步。未擅自改 manifest、未擅自宣告 v0.6 发版 |
| **`persona_conflict_check`** | ROADMAP 列为 🔲 未实装；代码 `packages/agent/src/reflection/runner.ts` 已有骨架分支（no-op 占位） | ✅ 已处置（2026-05-06）：ROADMAP 对应条目状态改为 🚧 在建（骨架已落，完整逻辑待实装），加注脚指向 runner.ts；本文件同步为 🚧 并补代码指针 |

---

## 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-05-06 | 初版创建；收录 v0.1 ~ v0.5.0 已发布能力 + v0.2.5+ 未来方向 + backlog B-001~B-005；给出合并时间线；附录 A 标注 3 条文档/代码不一致 | PM |
| 2026-05-06 | **新增 B-006**：记忆审核文案「关于你 / 关于用户」指代歧义；加入「一、基础对话与 UI」🔲 行、顶部数量统计更新（🔲 18→19、总数 51→52）、推进时间线在"近期"里紧随 B-001 插入搭车项、B-006 建议在 B-001 或 B-005 迭代里顺手合入 | PM |
| 2026-05-06 | **用户一次性拍板 4 条决策归档**：① DeepSeek R1 `reasoning_content` 采纳 C 方案（新增 `ChatChunk.reasoning` chunk 类型、UI 折叠展示） → B-001 行追加范围扩大标注；② B-006 文案定稿「关于助手」/「关于你」+ 去除 B-006 行重复条目、顶部数量统计回到 🔲 18 / 总数 51；③ ROADMAP 3 处不一致整同后，本文件附录 A 三行从"建议处置"改为"已处置"；④ 用户暂不开工，仅文档层修订 | PM |
| 2026-05-06 | **新增 B-007(三子项)**：Persona 记忆系统质量 —— 抽取边界显式化(A) + 记忆自整理工具(B) + 模型可切换(C)。三子项加入「三、记忆系统」分组🔲 行,A=P0 搭车 B-001、B/C=P1;顶部数量统计🔲 19→21 / 总数 52→54;推进时间线近期新增 B-007-A 排在 B-001 之后 B-006 之前,中期新增 B-007-B / B-007-C 排在 B-002 之后 / ROADMAP v0.6 之前;依赖关系反映"C 弱依赖 B-001、B 与 B-004 弱协同、A 独立" | PM |
| 2026-05-06 | **新增 B-008 · 开源仓库基础设施**：随根目录 `README.md` 重写为开源项目形态同步登记;汇总 LICENSE 落地 / CONTRIBUTING.md / Issue·PR 模板 / 截图素材 / CI 徽章真实化等杂项;归入「五、工程 / 可观测性 / 交付」分组🔲 行,P2 未排期;顶部数量统计🔲 21→22 / 总数 54→55。不擅自创建 LICENSE / CONTRIBUTING.md,留待项目所有者决策 | PM |
| 2026-05-06 | **新增 B-009(两子项) · 给 LLM 增加 Web 能力(WebFetch / WebSearch · 待调研)**:用户自陈"没思路",本条入档重点是列齐 6 条 Open Questions + 对标清单(Claude Code / Open WebUI / browser-use / LangChain / Tavily / SearxNG 等),推荐先研究 Claude Code · WebFetch / Open WebUI 联网搜索 / browser-use 三项。核查到现有 tool 体系在 `packages/tools/src/definitions/`(13 个 tool,`buildDefaultTools` 条件注册),**代码里无可复用的通用 fetcher 基础设施**;manifest MV3 + `host_permissions: ["<all_urls>"]` 全开(为 LLM baseURL),B-009 权限策略需显式重审。两子项均归入「四、Agent · 扩展性」分组🔲 行(理由: WebFetch/WebSearch 是 LLM 可调用的 tool,属于 Agent 能力边界的扩展,而非 UI 交互或工程治理;与 B-002/B-003/B-004 同组更自然),a=P1、b=P2;顶部数量统计🔲 22→24 / 总数 55→57;推进时间线远期段插入 B-009-a(第 12 位,先于 B-003)、B-009-b(第 14 位);B-003 条目补注"虚线依赖 B-009-a";ROADMAP v0.6 DSL 提取器条目补注"B-009 内容清洗层可复用"。留 4 条待用户拍板产品参数(首次访问确认 / 搜索引擎偏好 / 缓存时长 / SPA 支持范围) | PM |
| 2026-05-06 | **B-009 prompt-injection 风险决策归档**:用户判断"浏览器沙箱权限有限,prompt-injection 非 MVP 阻塞项,不投入额外防护成本";backlog B-009 Open Question #4 追加决策条、新增「已知并接受的残余风险」小节登记 3 条浏览器扩展特有残余风险(跨 tab 外泄 / API key 潜在外发 / 记忆污染)、「首次访问某域名用户二次确认」从待拍板迁入已拍板(**默认关闭**);`plan.md` 结构未改,仅本变更记录追加登记。B-009 待拍板参数从 4 条降至 3 条(搜索引擎偏好 / 缓存时长 / SPA 支持范围) | PM |
| 2026-05-06 | **B-009-b 迭代搜索特性明确 + 依赖关系翻转 + 排序调整**:用户架构性洞察"WebSearch 需要 subAgent 迭代访问网站获取数据"(等同 Claude / Perplexity / OpenAI Deep Research 的搜→拉→判→再搜范式)。本文件「四、Agent · 扩展性」表内 B-009-b 行描述追加迭代式搜索说明、来源列依赖改为"**强依赖 B-003 subAgent**;紧跟 B-003 之后";B-003 行来源列补注"启用下游 B-009-b";推进时间线第 13 项 B-003 补注"是 B-009-b 的硬前置"、第 14 项 B-009-b 从"远期"明确为"**B-003 subAgent 交付后**"并给出依赖理由。顶部对齐日期更新。数量统计无变化 | PM |
