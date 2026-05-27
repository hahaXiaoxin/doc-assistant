# Bugs 索引 · 已知缺陷 / 异常 / 待修复问题

> 本目录是 **产品 backlog 中"已知 bug"的可索引视图**:把散落在 `docs/backlog.md`(用户反馈型 bug)、`docs/ROADMAP.md`(延后未做型 bug)、`docs/TROUBLESHOOTING.md`(已知问题/排错)中**当前 open** 的、值得单独跟踪的 bug 提取出来,单文件单条目归档。
>
> 与原文档的关系:
> - **本目录只跟踪 open bug**(及个别 investigating 状态)。已修复(fixed)的踩坑请直接看 `TROUBLESHOOTING.md`,那里有完整的"症状 / 根因 / 修复 / 验证点 / 代码锚点"沉淀,本目录不重复登记。
> - 每条 bug 在"来源"字段指回原文档对应小节,方便溯源。

---

## 编号规则

- **ID 格式**:`bugs-NNN`(三位数字,从 001 起递增,**不重用**;即使 fixed / wontfix 也保留 ID)。
- **文件名**:`<id>.<kebab-case-主题>.md`,例如 `001.ref-chip-rendered-as-plain-text.md`。
- **状态**:`open` / `investigating` / `fixed` / `wontfix`。
- **优先级**:`P0`(阻塞性,必修)/ `P1`(影响日常体验)/ `P2`(可延后)/ `P3`(轻微,卫生级)。

## 新增 bug 的流程

1. 取下一个未使用 ID。
2. 在本目录新建 `NNN.<slug>.md`,套用模板:
   ```markdown
   # <中文标题>

   - **ID**: bugs-NNN
   - **状态**: open
   - **优先级**: P0 | P1 | P2 | P3
   - **来源**: backlog.md / ROADMAP.md / TROUBLESHOOTING.md / 真实用户反馈 等
   - **创建日期**: YYYY-MM-DD

   ## 现象
   ## 复现
   ## 根因
   ## 期望行为
   ## 备注
   ```
3. 在本 README 索引表追加一行;按 ID 升序保持。
4. **修复后不要删除文件**,把状态改为 `fixed`,在"备注"补一句"已于 vX.Y.Z 修复,见 CHANGELOG / TROUBLESHOOTING §N";同样 `wontfix` 时记录决策理由。

---

## 索引表

| ID | 主题 | 状态 | 优先级 | 文件 |
| --- | --- | --- | --- | --- |
| bugs-001 | 划词引用在气泡里降级为纯文本 | open | P1 | [001.ref-chip-rendered-as-plain-text.md](./001.ref-chip-rendered-as-plain-text.md) |
| bugs-002 | 记忆审核界面"关于你 / 关于用户"指代歧义 | open(文案已定稿,待实装) | P1 | [002.persona-review-pronoun-ambiguity.md](./002.persona-review-pronoun-ambiguity.md) |
| bugs-003 | Persona 抽取噪音 · 技能 / 工作流被误判进审核队列 | open | P0 | [003.persona-extraction-noise.md](./003.persona-extraction-noise.md) |
| bugs-004 | Persona top-k 截断 · 长尾审核通过的记忆永远进不了 prompt | open | P1 | [004.persona-topk-truncation.md](./004.persona-topk-truncation.md) |
| bugs-005 | SPA 场景页面摘要过期未主动刷新 | open | P2 | [005.spa-page-summary-stale.md](./005.spa-page-summary-stale.md) |
| bugs-006 | Provider baseURL 自定义时 host_permissions 未动态申请 | open | P2 | [006.host-permissions-dynamic-request.md](./006.host-permissions-dynamic-request.md) |
| bugs-007 | manifest 0.6.0-beta.1 与 ROADMAP / CHANGELOG 状态不一致 | investigating | P3 | [007.manifest-version-out-of-sync.md](./007.manifest-version-out-of-sync.md) |

---

## 本次提取的关键决策(2026-05-24 初版)

- **TROUBLESHOOTING §1–§4 / §6–§14 不入档**:全部已 fixed,且原文档已有完整"症状 / 根因 / 修复 / 验证点"沉淀,重复入档无价值。如未来发生回归,再以新 ID 入档(写明"§N 模式回归")。
- **TROUBLESHOOTING §5 输入卡顿 + 404 风暴**已 fixed,但其修复(`useMemo([visible])`)恰恰是 bugs-005(SPA 摘要过期)的根因之一 — 故 bugs-005 单独入档,不动 §5 的"已 fixed"地位。
- **TROUBLESHOOTING §8 (v0.5.0 已解除)** 不入档:架构层面已 deprecate,不存在残余风险。
- **B-005 / B-006 / B-007-A / B-007-B**(用户在 backlog 里以 B-编号登记的 4 条)中,B-005、B-006 是 100% 的 bug 形态(用户原话明确指出"这是 bug");B-007-A、B-007-B 虽以"想法"形态出现在 backlog,但本质是用户已报的体感问题(审核噪音 + 长尾不被注入),按口径**也算 bug**入档,与 ideas-005 / ideas-006 形成"bug ↔ 解决方案"对照关系。
- **bugs-007 manifest 版本不一致**只是文档卫生,不影响功能,以 P3 入档作为开源化打磨提醒。
