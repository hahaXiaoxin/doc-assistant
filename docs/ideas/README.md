# Ideas 索引 · 产品想法 / Feature / 改进

> 本目录是 **产品 backlog 的可索引视图**:把散落在 `docs/backlog.md`、`docs/ROADMAP.md` 等长文里"独立、可执行、值得单独跟踪"的想法,以**单文件单条目**的形式归档。
>
> 与 `docs/backlog.md`、`docs/ROADMAP.md` 的关系:
> - **本目录是只读快照 + 索引**:每条 idea 在"来源"字段指回原文档对应小节,方便溯源。
> - **权威仍在原文档**:重大讨论 / 演化记录请去 `backlog.md` 的对应 B-编号小节,本目录只做"提取 + 跟踪"。

---

## 编号规则

- **ID 格式**:`ideas-NNN`(三位数字,从 001 起递增,**不重用**;条目即使 done 或 wontfix 也保留 ID)。
- **文件名**:`<id>.<kebab-case-主题>.md`,例如 `001.custom-agent.md`、`009.web-fetch.md`。
  - 主题用简短英文 / 拼音 slug,便于命令行操作;中文标题在 README 表格里维护。
- **状态**:`proposed` / `in-progress` / `done` / `wontfix`。
- **优先级**:`P0`(必做,阻塞)/ `P1`(强烈建议)/ `P2`(可延后)/ `P3`(远期)。

## 新增 idea 的流程

1. 取下一个未使用 ID(看本表最大编号 + 1)。
2. 在本目录新建 `NNN.<slug>.md`,套用模板:
   ```markdown
   # <中文标题>

   - **ID**: ideas-NNN
   - **状态**: proposed
   - **优先级**: P0 | P1 | P2 | P3
   - **来源**: backlog.md / ROADMAP.md / 真实用户反馈 等
   - **创建日期**: YYYY-MM-DD

   ## 背景
   ## 提案
   ## 验收标准
   ## 备注
   ```
3. 在本 README 索引表追加一行;按 ID 升序保持。
4. 如果 idea 来自 `backlog.md` 已有的 B-编号小节,**不要把原小节删掉**,只在本文件"来源"字段指回去;`backlog.md` 的瘦身留待后续单独决定(详见汇报)。

---

## 索引表

| ID | 主题 | 状态 | 优先级 | 文件 |
| --- | --- | --- | --- | --- |
| ideas-001 | 自定义智能体(领域专家) | proposed | P1 | [001.custom-agent.md](./001.custom-agent.md) |
| ideas-002 | subAgent · 子智能体委派 | proposed | P2 | [002.sub-agent.md](./002.sub-agent.md) |
| ideas-003 | Skills · 可索引可调用的技能包 | proposed | P2 | [003.skills.md](./003.skills.md) |
| ideas-004 | 引用标签(Ref Chip)富媒体扩展 | proposed | P1 | [004.content-ref-chip.md](./004.content-ref-chip.md) |
| ideas-005 | Persona 抽取边界显式化 | proposed | P0 | [005.persona-extraction-boundary.md](./005.persona-extraction-boundary.md) |
| ideas-006 | Persona 记忆自整理(写入侧相似度 + 合并工具) | proposed | P1 | [006.persona-self-merging.md](./006.persona-self-merging.md) |
| ideas-007 | Persona 类调用支持独立 Provider | proposed | P1 | [007.persona-independent-provider.md](./007.persona-independent-provider.md) |
| ideas-008 | 开源仓库基础设施 | proposed | P2 | [008.opensource-infra.md](./008.opensource-infra.md) |
| ideas-009 | WebFetch · LLM 主动拉 URL | proposed | P1 | [009.web-fetch.md](./009.web-fetch.md) |
| ideas-010 | WebSearch · 迭代式联网检索 | proposed | P2 | [010.web-search.md](./010.web-search.md) |
| ideas-011 | 域名级 DSL 自学习文章提取器 | proposed | P1 | [011.domain-dsl-extractor.md](./011.domain-dsl-extractor.md) |
| ideas-012 | OCR / 多模态识图 | proposed | P2 | [012.ocr-multimodal.md](./012.ocr-multimodal.md) |
| ideas-013 | 云端同步(可选,E2EE) | proposed | P3 | [013.cloud-sync.md](./013.cloud-sync.md) |
| ideas-014 | Token 用量看板 | proposed | P1 | [014.token-usage-dashboard.md](./014.token-usage-dashboard.md) |
| ideas-015 | 集中化 AgentRuntimeConfig | proposed | P1 | [015.agent-runtime-config.md](./015.agent-runtime-config.md) |
| ideas-016 | 召回粗判 RECALL_PATTERNS 升级 | proposed | P2 | [016.recall-trigger-upgrade.md](./016.recall-trigger-upgrade.md) |
| ideas-017 | UI 层 tool-call 可观测性 | proposed | P2 | [017.tool-call-observability.md](./017.tool-call-observability.md) |
| ideas-018 | Prompt Caching 策略 · 重排上下文以最大化前缀命中 | proposed | P1 | [018.prompt-caching-strategy.md](./018.prompt-caching-strategy.md) |

---

## 本次提取的关键决策(2026-05-24 初版)

- **B-001 DeepSeek 不入档**:已随 `v0.6.0-beta.2` 落地(见 ROADMAP 表 + `docs/requirements/v0.6.0-beta.2-deepseek-provider.md`),按用户口径"已落地内容忽略"未拉条目。
- **B-007 拆 A / B / C 三条**:三个子项的状态、改动面、依赖差异显著,合一条会丢治理颗粒度。
- **B-009 拆 a / b 两条**:WebFetch 独立、WebSearch 强依赖 subAgent — 不拆会让"WebSearch 依赖关系"被淹没。
- **CheckerAgent 不单列**:已并入 ideas-001(B-002) 作为 `background` 型实例,不再单独演化(参见 ROADMAP §4 治理注脚)。
- **Persona 双主体重建** / **跨 visit 时间维记忆检索 / Chronological Index** / **记忆浏览器 Tab** 已分别随 v0.4.0 落地(ROADMAP 脚注 `[^chrono-v040]` 已勘误),不入档。
- **Session Topic 话题漂移主动检测** / **旧 visit 消息按距离裁剪** / **PersonaReviewList 批量审核** / **`/forget`** / **会话导入导出**等若干"延后小项"未单独建文件 — 它们改动面小、依赖明确,继续留在 ROADMAP `v0.2.5+` 名单里更便于"搭车合入",过早单条独立反而割裂上下文。如未来确实独立排期,再补条目即可。
- **ROADMAP §6 "本期延后"清单中的纯文档 / 纯 UI 项**(如完整 Markdown 渲染 / 配置页 Tour / Token 级上下文截断)均未拉条目 — 不构成"独立可执行"的产品线索,留在原清单中即可。
