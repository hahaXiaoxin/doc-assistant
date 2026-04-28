# 需求说明 · 移除 v0.1 向后兼容代码（v0.3.0）

> 状态：**已定稿（可交付 developer）**
> 版本目标：`v0.3.0`（标记 **breaking change**）
> 定稿日期：2026-04-29
> 关联 ROADMAP：`docs/ROADMAP.md · #代码清理 · 移除 v0.1 向后兼容代码`
> 关联 DESIGN HISTORY：`docs/v0.2-DESIGN-HISTORY.md · §七` TODO 条目

---

## 0. 背景与目标

项目尚未正式发布，v0.1 MVP 的兼容代码（`QWEN_CONFIG` 迁移、`MemoryRecord.sessionId`、`MemoryRecordType` 里的 `'summary' | 'fact' | 'reference'` 占位等）已成为长期无用包袱，散落在 `shared` / `memory` / `ui` / `extension` 四个包里。本次集中清理，干净切到 v0.2+ 的单一模型，消除长期维护成本，让后续新人理解代码路径更直接。

**核心取舍（已与用户澄清）**：

| 问题 | 决定 |
|---|---|
| Q1 · 对老用户 `doc-assistant.qwen-config` 残留数据怎么办？ | **丢弃**。不保留任何一次性迁移脚本；残留的 `QWEN_CONFIG` key 直接不再读取，用户重填 API Key。 |
| Q2 · P1 的三项"可选 → 必填"收紧做不做？ | **全做**。`UIMessage.visitId` / `SlashCommandContext` 新增能力 / `MemoryStore` 可选方法，三项一次性全部收紧为必填。 |
| Q3 · 版本号怎么打？ | **升级到 `v0.3.0`，标记 breaking change**（不是 v0.2.6）。 |
| Q4 · 如何告知用户？ | CHANGELOG 写 v0.3.0 breaking 条目；**不做** Options 页首次加载的 UI 提示（简化实现，移出范围）。 |

---

## 1. 最终范围（P0 / P1 / P2）

> 原 Q4 的"Options 首次加载 UI 提示"已从范围中**剔除**。

### P0 · 核心清理（必须做，构成 v0.3.0 主体）

1. **存储层 · 清理 `QWEN_CONFIG`**
   - `packages/shared/src/config.ts`
     - 删除 `STORAGE_KEYS.QWEN_CONFIG` 常量
     - 删除 `QwenConfig` interface、`DEFAULT_QWEN_CONFIG` 常量
     - 删除 `migrateQwenConfigToMain()` 函数
     - 从 `StorageSchema` 移除 `[STORAGE_KEYS.QWEN_CONFIG]` 条目
     - 文件头注释中"v0.1 → v0.2 迁移"相关段落一并删除
   - `packages/shared/src/__tests__/config.test.ts`
     - 删除 `DEFAULT_QWEN_CONFIG` / `migrateQwenConfigToMain` / `STORAGE_KEYS.QWEN_CONFIG` 相关 case
   - **不新增**任何"一次性清理 `doc-assistant.qwen-config` 残留 key"的脚本：按 Q1 决策，残留数据直接忽略，不读不写不删（用户新装或升级后第一次打开发现没 key，重填即可）。

2. **Bootstrap · 移除迁移路径**
   - `apps/extension/src/sidebar/bootstrap.ts`
     - 删除 `qwenLegacy` 读取分支
     - 删除 `migrateQwenConfigToMain` import 与调用
     - 主 Provider 读取简化为：`mainStored ?? DEFAULT_MAIN_PROVIDER_CONFIG`
     - 文件头注释里"兼容 v0.1 QWEN_CONFIG 迁移"一段删除
   - `packages/ui/src/features/options/OptionsForm.tsx`
     - 删除 `qwenLegacy` 读取分支与 `migrateQwenConfigToMain` 调用
     - 删除 `migrated` 状态、Save 时的 `storage.remove(QWEN_CONFIG)` 逻辑
     - 文件头注释里"v0.1 → v0.2 迁移策略"一段删除
   - **无 UI 提示**（Q4）：Options 页不新增"您的旧 v0.1 配置已被清除，请重新填写 API Key"这类 Alert 或 Modal。用户第一次打开 Options 看到空 API Key 是预期行为。

3. **Memory 接口 · 移除 v0.1 残留字段与未用类型**
   - `packages/memory/src/interface.ts`
     - `MemoryRecord` 删除 `sessionId?: string` 字段
     - `PersonaSource` 删除 `sessionId?: string` 字段
     - `MemoryRecordType` 从 `'message' | 'summary' | 'fact' | 'reference' | 'persona' | 'visit_summary'` 收窄为 `'message' | 'persona' | 'visit_summary'`
     - 文件头 / 类型上方注释里"v0.1 兼容"措辞同步删除
   - `packages/memory/src/db/dexie-store.ts`
     - `remember()` / `recall()` / 索引路由等处的 `case 'summary': case 'fact': case 'reference':` 分支删除（L114-116、L194-196 及其它相关 switch 分支）
     - 若存在 `sessionId` 的索引或写入代码，一并清除
   - `packages/memory/src/__tests__/dexie-store.test.ts` 等相关测试里涉及上述类型/字段的 case 删除或改写

### P1 · 类型收紧（全做，与 P0 同版本发布）

> 原本这些字段/能力是"可选 + 降级"给 v0.1 ↔ v0.2 过渡期用的保护网。v0.3 过渡期已结束，一次性收紧到必填，消除降级分支。

1. **`UIMessage.visitId` 改必填**
   - `packages/ui/src/hooks/useStreamingChat.ts`
     - `UIMessage.visitId: string`（去掉 `?`）
     - `UIMessage.visitTitle?: string` 保持可选（标题可缺失）
   - 所有产生 `UIMessage` 的地方（`send()` 内 userMsg / 流式 flush 的 assistantMsg）必须拿到有效 `visitId`；`getCurrentVisitMeta()` 改成**必填** port（参与 P1-2 一起收紧）
   - `groupMessagesByVisit` 及其单测（`packages/ui/src/hooks/__tests__/group-messages.test.ts`）：删除"兼容无 visitId 旧消息"的 case；现在 visitId 必有。

2. **`SlashCommandContext` 新增能力改必填**
   - `packages/ui/src/commands/types.ts`：把以下 5 个字段从 `?` 改为必填：
     - `startNewVisit: () => Promise<void> | void`
     - `triggerRecall: (query: string) => Promise<void>`
     - `triggerTopicIdentify: () => Promise<void>`
     - `setSessionTopic: (text: string) => Promise<void>`
     - `appendAssistantNote: (content: string) => void`
   - `notify?` 保持可选（真正为 UI 层 UX 锦上添花）
   - `packages/ui/src/commands/*.ts` 内部：删除 `if (ctx.startNewVisit)` 等降级分支；直接调用。命令实现里"能力未注入时的 fallback 文案"全部移除。
   - `ChatPanel.tsx` 的 `slashCtx` 构造处：确保 5 个能力都被装配（目前已装配，只是改成编译期必填）
   - `commands.test.ts` 里 `makeCtx()` helper 签名同步改成必填。

3. **`MemoryStore` 可选方法改必填**
   - `packages/memory/src/interface.ts`：把以下方法从 `?` 改为必填：
     - `getWorkingMemory` / `setWorkingMemory` / `touchWorkingMemory` / `archiveStaleWorkingMemories`
     - `listPersonas` / `addPersonaCandidate` / `updatePersona`
     - `setSessionTopic` / `getSessionTopic`
     - `enqueueReflection` / `listPendingReflections` / `updateReflection`
     - `recordPageVisit`
     - `close`
   - `packages/memory/src/null-store.ts`：`NullMemoryStore` 把这些方法全部实装为 no-op（目前多为可选未实现），保证生产唯一的两个实现（`DexieMemoryStore` / `NullMemoryStore`）都满足新契约
   - 所有调用方（`packages/agent/src/reflection/**` / `packages/tools/src/definitions/working-memory/**` / `packages/ui/**` / sidebar 装配层）：删除 `if (memory.getWorkingMemory)` 这类 optional-chaining 降级路径，直接调。
   - **契约红线不破**：`remember` / `recall` 签名完全不动（历史承诺的"永恒接口"）。本条只是把 v0.2 追加的**新方法**从可选收紧到必选。

### P2 · 文档与发布物（必须做，但低风险）

1. **CHANGELOG · `v0.3.0` breaking 条目**（Q4 决策）
   - `docs/CHANGELOG.md` 在 `[Unreleased]` 下新建 `## [v0.3.0] · 移除 v0.1 兼容 · Breaking Change` 段落
   - 必须覆盖的要点：
     - **Removed**：`QWEN_CONFIG` storage key、`QwenConfig` / `DEFAULT_QWEN_CONFIG` / `migrateQwenConfigToMain`、`MemoryRecord.sessionId` / `PersonaSource.sessionId`、`MemoryRecordType` 的 `'summary' | 'fact' | 'reference'`
     - **Breaking**：
       - 直接从 v0.1 升级（跳过 v0.2.x）的用户：`doc-assistant.qwen-config` 中的 API Key 不再自动读取；Options 页首次打开会显示空，用户需重新填写 API Key
       - `UIMessage.visitId` / `SlashCommandContext` 新增能力 / `MemoryStore` 新方法从"可选"收紧为"必填"；包的直接消费者需按新签名实现
     - **Not Migrated**：按意图不做一次性数据迁移脚本，不做 Options 页 UI 提示
     - **Upgrade Guide（给包的上游使用者）**：简短示例 3 条，分别对应 UIMessage / SlashCommandContext / MemoryStore 的升级写法
2. **ROADMAP 同步**
   - `docs/ROADMAP.md · #代码清理`：把该条目标记为 `[x]` 完成，附指向 v0.3.0 CHANGELOG 的锚链
3. **DESIGN HISTORY 同步**
   - `docs/v0.2-DESIGN-HISTORY.md · §七`：把"移除 v0.1 兼容..."那行从 TODO 清单中移出，或改写为"已于 v0.3.0 完成清理"
4. **TROUBLESHOOTING 无需改动**：本次没有踩坑记录新增。

> **不在范围内**（已按 Q4 明确排除）：
> - Options 页首次加载的 Alert / Modal / Toast 提示
> - 任何"一次性迁移脚本"或"清除 `doc-assistant.qwen-config` 残留 key"的 bootstrap 清洁逻辑
> - `ChatSettings.systemPrompt` 旧存储 key 的兼容分析（ROADMAP 里写了"如仍存在旧存储 key"，全仓扫描确认不存在即止；若存在再另立任务，不在 v0.3.0 内处理）

---

## 2. 验收标准

### 代码层
- [ ] 全仓 `grep -r "QWEN_CONFIG\|qwen-config\|DEFAULT_QWEN_CONFIG\|QwenConfig\|migrateQwenConfigToMain"` 仅剩 CHANGELOG 历史条目命中，其它处 0 命中
- [ ] 全仓 `grep -r "sessionId"` 在 `packages/memory/**` 下 0 命中（历史文档中的引用保留）
- [ ] 全仓 `grep -r "'summary'\|'fact'\|'reference'"` 在 `packages/memory/**` 下 0 命中
- [ ] `MemoryRecordType` 精确等于 `'message' | 'persona' | 'visit_summary'`
- [ ] `UIMessage.visitId` / `SlashCommandContext` 新增 5 能力 / `MemoryStore` 14 方法（见 P1-3 清单）全部非可选；`NullMemoryStore` 提供 no-op 实现
- [ ] 所有对上述接口的调用端**已删除**降级分支（`if (memory.getWorkingMemory)` 类代码 0 命中）

### 质量门禁
- [ ] `pnpm typecheck` 0 error（收紧可选后，任何遗漏的降级调用会编译失败，天然兜底）
- [ ] `pnpm lint` 0 error
- [ ] `pnpm test` 全绿（预估：`groupMessagesByVisit` 9 case 中"无 visitId"1 case 删除；dexie-store 相关老类型 case 调整；其余不应变动）
- [ ] `pnpm build` 成功产出 extension

### 手测回归
- [ ] 全新安装（无任何历史 storage）：首次打开 Options，填 API Key → 正常对话
- [ ] 模拟 v0.1 用户（`chrome.storage.local` 预置 `doc-assistant.qwen-config` = { apiKey, baseURL, model, enableThinking }，无 `doc-assistant.main-provider-config`）：Options 首屏 API Key 为空（按 Q1 决策），重填后正常工作；旧 key 残留不影响功能
- [ ] 已升级 v0.2.5 用户（只有 `doc-assistant.main-provider-config`）：升级到 v0.3.0 无感知，配置和历史 IDB 记忆全部保留
- [ ] 斜杠命令 `/new` / `/recall foo` / `/topic` / `/topic bar` 全部正常

### 发布物
- [ ] `docs/CHANGELOG.md` 增加 v0.3.0 breaking 条目，包含 Removed / Breaking / Upgrade Guide 三小节
- [ ] `docs/ROADMAP.md` 和 `docs/v0.2-DESIGN-HISTORY.md` 的 TODO 同步勾掉
- [ ] `package.json`（仓库根与各子包）`version` 字段统一升到 `0.3.0`

---

## 3. 风险与备注

- **最大风险点**：P1-3 `MemoryStore` 收紧后，若仓库外有包消费 `MemoryStore` 接口（自研 store 实现），他们会编译失败。本仓库为单仓项目，无外部消费者，风险可忽略；但 CHANGELOG 里仍要以 Upgrade Guide 形式显式告知。
- **Q1 决策的代价**：从 v0.1 直接跳到 v0.3 的用户（项目未发布，此类用户几乎不存在）需要重填 API Key。交付时 Q4 明确不做 UI 提示，"空 API Key 即信号"作为产品语义接受。
- **版本号连续性**：v0.2.5 之后跳到 v0.3.0，中间无 v0.2.6；CHANGELOG 段落顺序 `[Unreleased] → [v0.3.0] → [v0.2.5] → ...`，不留"假版本号"。
- **测试数量预期变化**：从 v0.2.5 的 315 基线大致不变或 -1 到 -3（删除了少量降级兼容测试，但 NullMemoryStore 新实现的 no-op 和 schema 收紧本身不新增测试需求）。developer 实施时若测试大幅变动，需在 PR 描述里列明。
- **数据库 schema**：本次清理**不改 Dexie schema 版本号**，也**不改表结构**。只是 `MemoryRecord.type` 的 TS 联合收窄——如果 IDB 里有历史 `type='fact'` 等记录（几乎不可能，v0.2 生产路径从未写入），读出时会在 TS 层错配，读路径需做一次 defensive drop（读到非 `'message' | 'persona' | 'visit_summary'` 的记录忽略）。developer 在 `DexieMemoryStore` 的 read path 里加一条 filter 即可，不作为 breaking 暴露到上层。

---

## 4. 交付物清单

| 类别 | 路径 |
|---|---|
| 代码改动 | `packages/shared/src/config.ts` / `packages/shared/src/__tests__/config.test.ts` |
| 代码改动 | `apps/extension/src/sidebar/bootstrap.ts` |
| 代码改动 | `packages/ui/src/features/options/OptionsForm.tsx` |
| 代码改动 | `packages/memory/src/interface.ts` / `packages/memory/src/null-store.ts` / `packages/memory/src/db/dexie-store.ts` 及相关 `__tests__` |
| 代码改动 | `packages/ui/src/hooks/useStreamingChat.ts` / `packages/ui/src/hooks/__tests__/group-messages.test.ts` |
| 代码改动 | `packages/ui/src/commands/types.ts` / `packages/ui/src/commands/*.ts` / `packages/ui/src/commands/__tests__/commands.test.ts` |
| 代码改动 | `packages/ui/src/features/chat/ChatPanel.tsx` 的 `slashCtx` 装配 |
| 代码改动 | 所有 `MemoryStore` 可选方法的消费端（agent / tools / sidebar），删除 optional-chaining |
| 版本号 | 仓库根 `package.json` 与所有 workspace 子包 `version: 0.3.0` |
| 文档 | `docs/CHANGELOG.md` · 新增 v0.3.0 breaking 条目 |
| 文档 | `docs/ROADMAP.md` / `docs/v0.2-DESIGN-HISTORY.md` · 同步 TODO 状态 |

---

**Developer 开工前请再确认**：本文档 §1 的 P0 / P1 / P2 与 §0 的 Q1~Q4 决策是最终版本。若实施中发现新的兼容代码残留，按 §1 的同类原则处理并追加到 CHANGELOG `v0.3.0` 的 Removed 列表。
