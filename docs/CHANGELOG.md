# Doc Assistant · 变更日志（CHANGELOG）

> 仅记录**对外可见行为**或**架构/约定**上的变动。纯 refactor、测试补充等不记录。
> 格式参考 [Keep a Changelog](https://keepachangelog.com/)，日期为 UTC+8。

---

## [0.6.0-beta.2] · DeepSeek Provider + OpenAICompatible 基类抽离

> 第二家 Provider 接入 + 顺手做最小代价的 OpenAI 兼容基类抽象；从此再接第三家（OpenAI /
> Moonshot / 自托管）只需"填表"，不必每家重写 250 行。
>
> 详细设计见 [`docs/requirements/v0.6.0-beta.2-deepseek-provider.md`](./requirements/v0.6.0-beta.2-deepseek-provider.md)。

### Added

- **DeepSeek Provider**（`packages/provider/src/deepseek/`）：官方端点 `https://api.deepseek.com`
  - 当前线上两款模型：`deepseek-v4-flash`（低成本快响应档）与 `deepseek-v4-pro`（主力档），
    官方规格均为 **1,000,000 tokens 上下文 / 384,000 tokens 单次最大输出**（能力表已声明；
    运行时默认 `max_tokens` 仍由上层保守决定，不自动撑到此上限）。
    若上游自发返回 `reasoning_content`，经 `ChatChunk.reasoning-delta` 流出 → UI
    `ThinkingBlock` 折叠展示（链路保留，未与具体模型名绑定）
  - 完整 chat / stream / tool call / usage / error 五条路径
- **OpenAICompatible 基类**（`packages/provider/src/openai-compatible/`）：
  - `OpenAICompatibleProvider` · chat 流式 + tool call + ChatMessage→CoreMessage + jsonSchemaToZod
  - `OpenAICompatibleEmbeddingProvider` · /embeddings 分批 + 维度校验
  - `listOpenAICompatibleModels` · /models 骨架
  - `normalizeStreamPart` · AI SDK → ChatChunk 归一化
  - 错误归一化工具（`mapHttpErrorToProviderError` 等）
- **Provider Registry**（`packages/provider/src/registry.ts`）：声明式 `kind → {LLM 工厂 /
  embedding 能力 / listModels / 默认配置 / 推荐组合}` 映射。新增 OpenAI 兼容 Provider 只需
  一行登记 + 一个目录。
- **组合渠道推荐按钮**（`MemoryTab`）：主 Provider 为 DeepSeek（无 embedding）且 embedding
  仍 `useMain=true` 时，顶部黄色警告 + "一键使用推荐配置（Qwen text-embedding-v3）"按钮。
- **保存前软校验**（`OptionsForm`）：同上组合下弹 `Modal.confirm`，用户可选"继续保存"
  或"改成推荐配置"。
- **DeepSeek 默认配置** `DEFAULT_DEEPSEEK_PROVIDER_CONFIG`（`packages/shared/src/config.ts`）。
- **`ModelInfo.maxOutputTokens?: number` 可选字段**（`packages/provider/src/interface.ts`）：
  能力表首次登记"单次最大输出 token 上限"。DeepSeek 两款均填 `384_000`；Qwen 暂不强制
  回填，字段可选不破坏旧代码。UI 下拉 tooltip（`BasicTab` / `ProviderConfigForm`）
  检测到该字段后追加 "· max_out ≈ N tokens" 展示。
- 新增 29 个单测覆盖 DeepSeek（chat / tool call / reasoning-delta / usage / error 路径）
  与 Provider Registry。

### Changed

- **Qwen Provider 瘦身**：`QwenProvider` / `QwenEmbeddingProvider` / `listQwenModels` 继承
  或复用 OpenAICompatible 基类；千问特化只保留 `enable_thinking` 透传 extra_body 与
  `CAPABILITY_TABLE` 分类规则。`qwen/normalizer.ts` 降为 re-export 壳（向后兼容）。
- **UI 改为 Registry 驱动**：`BasicTab` / `ProviderConfigForm` / `MemoryTab` 的 Provider
  下拉、默认 baseURL、拉模型函数、zod 校验（改用 `z.discriminatedUnion('kind', ...)`）
  全部读 `PROVIDER_REGISTRY`，不再出现 `kind === 'qwen' ? ...` 硬编码分支。
- **装配层 Registry 化**：`sidebar/bootstrap.ts` / `offscreen/index.ts` 从 `new QwenProvider(...)`
  改为 `PROVIDER_REGISTRY[kind].createLLM(...)`；支持 main=DeepSeek / aux=Qwen /
  embedding=Qwen 等任意跨 Provider 组合。
- **Offscreen embedding 降级更聪明**：主 Provider 无 embedding 能力且 `embedding.useMain=true`
  时不再盲目尝试（DeepSeek 下会 404），直接降级到关键词召回，主对话完全正常。
- **`ProviderKind` 联合扩展**为 `'qwen' | 'deepseek'`（纯加法，老 Qwen 配置原样工作）。
- **API Key 改为按 Provider 分桶存储**（`STORAGE_KEYS.PROVIDER_CREDENTIALS`）：
  新增独立的凭证子树 `{ qwen: { apiKey, baseURL? }, deepseek: {...} }`。UI 切换
  Provider 时自动从桶里带出对应 Key，不再出现"换 Provider 要重填 Key"。main /
  aux / embedding 三套 Provider 配置共享同一套桶——main=DeepSeek 填过 Key 后，
  aux 切到 DeepSeek 会自动带出。旧用户首次加载时幂等迁移旧字段到桶；多次加载
  不会覆盖用户新填的值（迁移函数 `migrateProviderCredentials`）。

### Notes

- **Embedding 下拉直接屏蔽 DeepSeek**（相较 v0.5.1 历史 PRD 口径调整）：官方无 embedding
  服务，保留选项只会制造支持工单。`ProviderConfigForm` 的 embedding mode 不展示
  Provider 下拉，kind 固定为 `qwen-embedding`。未来若需暴露"自托管 OpenAI 兼容 embedding"
  作为独立 kind，单独立项。
- `ChatChunk.reasoning-delta` 契约**未改**（v0.5.x 已就位），DeepSeek-R1 直接复用现有链路。
- 老 Qwen 用户升级**无需任何操作**；新安装用户默认主 Provider 仍为 Qwen。

### Version

- `apps/extension/manifest.json` `version_name`：0.6.0-beta.1 → 0.6.0-beta.2
- 根 `package.json` + 所有 workspace 子包 + `apps/extension` 的 `version` 统一为 `0.6.0-beta.2`

---


## [v0.5.0] · 统一记忆 · Offscreen Document 架构

> v0.4.0 真机测试暴露架构级问题：sidebar 跑在 content script 里，IndexedDB 按宿主域名
> （`https://bilibili.com` / `https://github.com` / ...）各自隔离——每个域名一份独立的
> "agent + 记忆 + 数据库"，违背产品本意（"所有域名共用一个 agent，上下文、数据库互通"）。
> 配置页"记忆浏览器" Tab（扩展 origin）也因此空空如也，是同一根因的副作用。
>
> 本版本把 IndexedDB 从 content-script origin 搬到扩展 origin 下的 **Offscreen Document**，
> sidebar / options 通过 `chrome.runtime.sendMessage` 代理读写，所有域名共用同一套记忆。
> 顺手把 `docs/TROUBLESHOOTING.md §8` 登记的"SW 唤醒 sidebar 执行反思 Job"绕路彻底删除，
> 反思 Job 迁到 offscreen 直接跑。
>
> 详细设计见 [`docs/requirements/v0.5.0-unified-memory.md`](./requirements/v0.5.0-unified-memory.md)。

### Added

- **`RemoteMemoryStore`**（`packages/memory/src/remote/remote-store.ts`）：实现 `MemoryStore` 契约的消息代理，sidebar / options 用它替代 `DexieMemoryStore` 直接构造。内置 pending map / rpcId 匹配 / 15s 超时 / 错误还原。
- **Offscreen Document 架构**：
  - `apps/extension/src/offscreen/index.ts` 为 offscreen entry，唯一真实 `DexieMemoryStore` 宿主
  - `apps/extension/src/offscreen/offscreen.html` 最小骨架 HTML
  - `apps/extension/src/background/memory-handler.ts` 封装 `ensureOffscreenAlive()`（幂等）与 `routeMemoryRpc()`
  - `manifest.json` 新增 `offscreen` 权限
- **`MEMORY_RPC_REQUEST` / `MEMORY_RPC_RESPONSE` envelope**（`packages/shared/src/messaging.ts`）：22 条 MemoryStore 方法 1:1 透传 RPC；`rpcId` 匹配、`{ok, result | error}` 标准化响应。
- **`REFLECTION_TICK` 控制消息**（`packages/shared/src/messaging.ts`）：SW 听 `chrome.alarms.onAlarm` 后转发给 offscreen，替代老的 `REFLECTION_SCAN_TICK` 广播。
- **`PAGE_VISIT_ENDED` 控制消息**（`packages/shared/src/messaging.ts`）：sidebar PageVisit 结束时通知 offscreen 登记反思任务并尝试立即跑。
- **`remote-store.test.ts`**：对 22 条 RPC 方法的正常 / 错误 / 超时路径做单测全覆盖。

### Changed

- **反思 Job 迁移到 Offscreen**：`ReflectionRunner` / `ReflectionScheduler` 的 `import` 与装配从 sidebar 搬到 `apps/extension/src/offscreen/index.ts`；`QwenProvider`（aux）与 `QwenEmbeddingProvider` 也在 offscreen 内实例化。反思 Job 不再依赖 sidebar 在线，offscreen 常驻、不挂起。
- **DB 统一在扩展 origin**：`DexieMemoryStore` 只在 `apps/extension/src/offscreen/index.ts` 构造；sidebar bootstrap / options bootstrap 改为 `new RemoteMemoryStore()`。
- **SW alarm 路径**：`chrome.alarms.onAlarm` 处理改为 `ensureOffscreenAlive()` + 转发 `REFLECTION_TICK`；SW 不再直接跑任务逻辑。
- **`minimum_chrome_version: 109`**：`chrome.offscreen` API 从 Chrome 109（2023-01 发布）起可用，manifest 显式声明版本下限，避免低版本 Chrome 安装后 crash。
- **Bootstrap 返回值**：`bootstrapAgent` 移除 `reflectionScheduler` 字段（对应调用点同步清理）。

### Removed

- **`MessageType.REFLECTION_SCAN_TICK`**：`packages/shared/src/messaging.ts` 删除该枚举项及 `ReflectionScanTickMessage` 接口。
- **sidebar 里的 `ReflectionRunner` / `ReflectionScheduler` 构造**：`apps/extension/src/sidebar/bootstrap.ts` / `sidebar/index.tsx` 不再 import / 构造反思相关模块。
- **sidebar 对 `REFLECTION_SCAN_TICK` 的 `chrome.runtime.onMessage` 监听**：由 offscreen 内部直接响应 `REFLECTION_TICK` 取代。
- **`docs/TROUBLESHOOTING.md §8` 的绕路方案**：SW 唤醒 sidebar 执行反思 Job 的历史方案已被标记为"v0.5.0 已解除"，保留为历史条目。

### Breaking

> ⚠️ 升级前请确认 Chrome 版本 **≥ 109**（macOS / Windows / Linux 均 OK，Chrome 109 是 2023-01
> 发布的版本，基本所有人都已到）。低于 109 的浏览器会被 manifest `minimum_chrome_version`
> 直接拒绝安装。

- **所有宿主域名原先的 IDB 数据被丢弃**：v0.4.0 及更早版本在 `https://bilibili.com` / `https://github.com` / `https://zhihu.com` 等宿主 origin 下各自落过 `doc-assistant` IDB。v0.5.0 起代码**只读扩展 origin 下的唯一一份 IDB**，老数据技术上仍残留在宿主 origin，但**新代码永远不读**。用户需重新积累记忆。
  - 决策依据：产品未正式发布、内测用户极少；跨 origin 迁移 IDB 需 content-script 配合，复杂度远超收益；强制"重建记忆"换来架构清洁
  - 想手动清理残留？在 Chrome DevTools · Application · IndexedDB 下按 origin 删除即可（不删也无功能影响，仅占用磁盘空间）
- **Chrome 108 或更低版本不再支持**：`chrome.offscreen` API 要求 Chrome 109+（2023-01 发布）。`minimum_chrome_version: "109"` 已写入 manifest，低版本浏览器安装时 Chrome 会直接拒绝，不会出现装上后 crash 的情况。

### Version

- 仓库根 `package.json` 与 6 个 workspace 子包（`memory` / `agent` / `tools` / `ui` / `shared` / `provider`） + `apps/extension` 的 `version` 统一为 `0.5.0`
- `apps/extension/manifest.json · version` 同步为 `0.5.0`
- `workspace:*` 依赖关系保持不变

---

## [v0.4.0] · 可见且可按时间检索的记忆系统

> v0.3.0 砍掉 v0.1 兼容包袱后，记忆层进入"能用但不透明"状态：数据都在 IDB 黑盒里，
> 用户既看不到、也不能按时间维度检索；Persona 一锅烩把"对 agent 的定义"和"对 user 的定义"
> 混在一起存、混在一起注入，LLM 在第二人称语境下容易误读；话题漂移靠每 4 轮周期，
> 无法即时响应；`host_permissions` 只覆盖千问两个域，用户自配 baseURL 的 Provider 被
> CORS 拦截。
>
> 本版本把记忆系统从黑盒变成**可见可审**的"时序自传"，并顺手把 Persona 双主体、话题漂移
> 关键词触发、全量 host_permissions 三件小事一并结清。详细设计见
> [`docs/requirements/v0.4.0-visible-memory.md`](./requirements/v0.4.0-visible-memory.md)。

### Changed

- **`host_permissions` 放开为 `<all_urls>`**（需求 5）
  - `apps/extension/manifest.json` 移除 `https://dashscope.aliyuncs.com/*` 与 `https://dashscope-intl.aliyuncs.com/*` 白名单，改为 `["<all_urls>"]`
  - 动机：v0.3.0 的 Provider 抽象允许用户自配 baseURL（OpenAI / Anthropic / 自托管等），白名单外的域被 CORS 默默拦截且无错误提示
  - 决策：**统一放开，不做 per-provider 白名单 / 不做 `optional_host_permissions` 动态申请**（详见 `docs/requirements/v0.4.0-visible-memory.md` §1 · 需求 5）
  - 用户可感：升级时 Chrome 会弹出"扩展请求新权限"的提示，需点"接受"；拒绝则插件禁用（Chrome 默认行为）

### Added

- `docs/PRIVACY.md`：完整隐私政策。三条核心——API Key 仅存本机 / 对话 & 摘要仅发到用户配置的 baseURL / IDB 记忆完全本地；并显式声明 `<all_urls>` 的必要性（LLM 端点由用户决定，无法预声明）
- `docs/CWS-REVIEW-NOTES.md`：Chrome Web Store 审核 justification 模板（英文）。逐项权限 + `<all_urls>` 广域权限 + 数据使用披露清单
- README 文档索引补充隐私 / CWS 入口链接
- BasicTab 的 Base URL 字段补一行 secondary text 说明"已放开所有域，可填任意 OpenAI 兼容 baseURL"
- 需求 1/2/3/4 的主体能力（Persona 双主体、Chronological Index、记忆浏览器 Tab、话题漂移关键词触发）随 tag 发布（详见 `docs/requirements/v0.4.0-visible-memory.md`）

---

## [v0.3.0] · 移除 v0.1 兼容 · Breaking Change

> 项目尚未正式发布，v0.1 MVP 的兼容代码（`QWEN_CONFIG` 迁移、`MemoryRecord.sessionId`、
> `MemoryRecordType` 里的 `'summary' | 'fact' | 'reference'` 占位等）已成为长期无用包袱，
> 散落在 `shared` / `memory` / `ui` / `extension` 四个包里。本次集中清理，干净切到
> v0.2+ 的单一模型，消除长期维护成本。

### Removed

- **存储层**：
  - `STORAGE_KEYS.QWEN_CONFIG`（对应 `doc-assistant.qwen-config` key）
  - `QwenConfig` / `DEFAULT_QWEN_CONFIG` / `migrateQwenConfigToMain()`
  - `StorageSchema` 的 `[STORAGE_KEYS.QWEN_CONFIG]` 条目
- **Memory 接口**：
  - `MemoryRecord.sessionId?`、`PersonaSource.sessionId?` 字段
  - `MemoryRecordType` 里的 `'summary' | 'fact' | 'reference'`（收窄为
    `'message' | 'persona' | 'visit_summary'`）
- **Bootstrap / OptionsForm 迁移链路**：
  - `bootstrap.ts` 的 `qwenLegacy` 读取分支与 `storage.remove(QWEN_CONFIG)` 写回
  - `OptionsForm` 的 `migrated` state、"已从 v0.1 迁移"Alert、保存后 `storage.remove`

### Breaking（跨包契约）

- **`UIMessage.visitId` 必填**（原 `visitId?: string`）。
  - `groupMessagesByVisit` 删除 `?? null` 兜底；读取层对缺 `visitId` 的老数据
    **过滤 + warn 计数**，不做回填归档。

- **`SlashCommandContext` 5 项新增能力必填**（原 `?`）：
  `startNewVisit` / `triggerRecall` / `triggerTopicIdentify` / `setSessionTopic` /
  `appendAssistantNote`。`notify` 保持可选。所有命令实现删除"能力未注入时的 fallback 文案"。

- **`MemoryStore` 14 项原可选方法必填**：
  `getWorkingMemory` / `setWorkingMemory` / `touchWorkingMemory` /
  `archiveStaleWorkingMemories` / `listPersonas` / `addPersonaCandidate` /
  `updatePersona` / `setSessionTopic` / `getSessionTopic` / `enqueueReflection` /
  `listPendingReflections` / `updateReflection` / `recordPageVisit` / `close`。
  - `remember` / `recall` 签名不变（历史"永恒接口"承诺维持）。
  - `NullMemoryStore` 已提供全部 no-op 实现；`DexieMemoryStore` 原本即全部实现。
  - interface JSDoc 明确"实现必须幂等且可重复调用"。

- **对直接从 v0.1 升级（跳过 v0.2.x）的用户**：`doc-assistant.qwen-config` 中的
  API Key 不再自动读取；Options 页首次打开会显示空，**需重新填写 API Key**。
  此为 Q1 决策：不保留一次性迁移脚本，残留 key 直接忽略。

### Upgrade Guide

对包的上游消费者（若自研 MemoryStore / 自定义命令宿主），按以下模式升级：

```ts
// 1) UIMessage
const msg: UIMessage = {
  id, role: 'user', content,
  visitId: currentVisit.visitId, // 必填
};

// 2) SlashCommandContext
const ctx: SlashCommandContext = {
  clearConversation, closeMenu, notify,
  startNewVisit, triggerRecall, triggerTopicIdentify,
  setSessionTopic, appendAssistantNote,
};

// 3) MemoryStore：自研 store 需补齐 14 个原可选方法（可参考 NullMemoryStore 的 no-op）
```

### Changed

- **DexieMemoryStore · recall 读路径 schema 防腐**：读出记录若 `type` 不在新合法集合内，
  跳过并 `console.warn` 计数（防腐，不是兼容）。这是为 IDB 里可能存在的遗留
  `type='fact'` 等脏数据兜底。
- **Dexie schema 版本号不变**：仅 TS 联合类型收窄，不改表结构。

### Not Migrated（按意图不做）

- 不做一次性数据迁移脚本（`doc-assistant.qwen-config` 直接丢弃）。
- 不做 Options 页 UI 提示（"空 API Key 即信号"作为产品语义接受）。

### Version

- 仓库根与所有 workspace 子包 `version` 统一 `0.3.0`（从 `0.1.0` 跳过 `0.2.x`，
  中间无发布版本）。

---

## [v0.2.5] · 刷新预热机制回退 · "意图驱动"的召回架构修正

> v0.2.3 引入的"三段式 rehydrate"在真机使用后发现一个设计偏差：
> **mount 时无脑按 canonicalUrl 跨 visit 拉 10 条消息塞进 history**，这违反了召回应当由
> **用户意图驱动**的原则——大多数场景用户刷新是为了"继续当前任务"，
> WorkingMemory（activeGoal + TODO）已经足够指示"正在做什么"，再塞历史消息反而：
> - 浪费 token（每次 send 都前置这 10 条）
> - 可能让 LLM 把旧对话当作当前对话的一部分
> - 新文章下刷新时，完全不相关的旧对话也被喂进去
>
> 本版本撤回这个预热设计，恢复"**意图驱动**"的三档架构：
>
> - **默认（延续当前工作）**：`WorkingMemorySource` 自动注入 activeGoal + TODO
> - **时间维元查询**（"今天/本周看了什么"）：走 Chronological Index（新能力，ROADMAP 登记）
> - **语义历史指代**（"上次/之前聊的 XX"）：走 `RelevantMemorySource` 向量召回

### Changed

- **删除 `sidebar/index.tsx` 的 rehydrate useEffect**：
  - 不再在 mount 时自动调 `memory.recall({types:['message'], canonicalUrl})` 预热 history
  - 刷新后 `useStreamingChat.messages` 保持 `[]`（符合 React 语义）
  - `initialHistoryForLLM` port 定义保留在 `useStreamingChat` / `ChatPanel`，
    供未来 Chronological Index 能力落地时复用（时间维查询会通过这个 port 注入时间轴命中结果）

### Unchanged（关键：保留数据基础）

- **`persistMessage` 落库完全保留**：每条 user / assistant 消息仍会同步写入 `episodes_msg`。
  这是 Chronological Index / 向量召回 / 反思 Job 共同依赖的数据基础——它是数据**沉淀**，
  不同于数据**注入**。v0.2.3 修的这一层是必须保留的。
- 反思 Job / SessionTopic 自动识别 / hashchange 清旧 topic / 跨 visit 消息分组降级
  等 v0.2.1 → v0.2.4 的能力全部不变。

### Acknowledged Trade-off

**刷新后"承接式失忆"**：如果用户刷新前聊到一半（例如讨论某个架构的 Controller 层），
刷新后说"然后呢"这种承接式输入，LLM 不会自动拿到上次对话。此时用户需要自己简短补一句
上下文（"我们刚聊到 Controller..."），LLM 再基于 history 的原消息响应即可。

这个代价是**有意接受的**——极小概率场景换来大多数场景的上下文纯净。如果真机发现此场景
高频发生，可加一个"30 分钟内同 visit 的 episodes_msg 轻量兜底"的窄条件预热（已登记 ROADMAP）。

### Testing

- 315 tests 全绿（无减少，rehydrate 删除后对应的 dexie-store 跨 visit 召回单测仍保留——
  底层能力未删，只是 sidebar 不再在 mount 触发）
- lint / typecheck 0 error

---

## [v0.2.4] · 上下文分层机制可用化 + UI 两处 bug 修

> 真机使用 v0.2.3 后发现的六个问题中的 2-6。1（Persona 双主体）改回 ROADMAP 重开讨论。
>
> 核心价值：让"你描述的上下文分层机制"从**架构上已有**变成**真的能运转起来**——
> SessionTopic 终于会自动识别了；hashchange 切文章会清旧话题；跨 visit 的历史消息被正确降权；
> 两处顶部 UI 的假象 bug 也一并修掉，让用户能看到真实信息。

### Added

- **`useStreamingChat.onRoundFinished` port**：每轮对话（user + assistant）完成时抛出
  `{ userMessageCount, recentMessages }` 信号，由 sidebar 接手触发 SessionTopic 识别等副作用。
- **`useStreamingChat.getCurrentVisitMeta` port**：send 时查询当前 PageVisit 元信息，给
  追加的 user/assistant 消息打 `visitId` + `visitTitle` 标签。
- **`groupMessagesByVisit()` 纯函数**：按 visitId 分组消息，非当前 visit 的消息前置
  system 段`# 之前在《上篇文章》中的对话（N 条）` + 明确降权提示。9 个单测覆盖。
- **`PageContextCard` 独立组件**：替代 ChatPanel 内联的 `ContextCard`，支持展开查看真实
  摘要内容（500 字上限 + max-height 滚动）；低可信 extractor（full-body）显式标注降级提示。
- **`PageSummary.extractor` 字段**：sidebar 的 `buildPageSummary` 透传摘要来源标签，UI
  据此判断可信度。

### Changed

- **`useStreamingChat.send` 组装 history 升级**：`initialHistoryForLLM` + `groupMessagesByVisit(messages)`
  组合，非当前 visit 的消息被自动降级注入——Agent 明确知道这是"过去对话，不是当前问题"。
- **`UIMessage` 新增 `visitId` / `visitTitle`**：向后兼容（旧消息无这两个字段时视为当前 visit）。
- **sidebar 新增 `hashchange` 监听**：hash 变化时清当前 visit 的 `SessionTopic`（不切 visit，
  规避反思 Job 等重操作）；下一轮用户提问时由 `shouldIdentify(1)=true` 自然触发新话题识别。
- **sidebar 新增 `onRoundFinished` 装配**：每轮后用 `shouldIdentify(userMessageCount)` 判定，
  true 则调用 `identifySessionTopic`。之前 SessionTopic 只能靠 `/topic` 命令手动触发，
  现在每 4 轮自动识别一次，配合 hashchange 清 topic 实现"话题自动跟随文章切换"。
- **`WorkingMemoryCard` 展开态**：`activeGoal 非空 + todos 空` 时，展开显示完整 goal 详情
  与"暂无 TODO"兜底，不再只见 chevron 旋转动画。

### Fixed

- **问题 5**：WorkingMemory 卡片在特定边界状态下展开只有 chevron 动画无内容。
- **问题 6**：顶部页面上下文卡片永远显示"201 字摘要"这串元信息数字而非真实内容。
- **问题 2**：SPA 哈希路由场景下切换文章后 Agent 仍回答上一篇内容——因为 hashchange
  既没被监听，`canonicalizeUrl` 又会剥 hash 导致 visit 不切。
- **问题 4**：SPA 内切换文章后，聊天窗口历史消息仍以"当前对话"身份全量喂给 LLM，
  容易让新文章的问题被上一篇上下文污染。
- **问题 3 的第一步**：SessionTopic 早期写了识别函数但实际生产代码**从未自动触发**，
  只能靠用户手动执行 `/topic` 命令。现在每轮对话后自动判定，完成闭环。

### Not Yet

- 问题 1（Persona 双主体 agent/user 区分）改到 ROADMAP `v0.2.4+ · 记忆层完善` 重开讨论，
  因为 v0.2.2 的"统一化"决策需要被**谨慎复审**——不想再来一次语义反转。
- 问题 3 的剩余工作（话题漂移主动检测、旧 visit 消息按距离/字数裁剪）也在 ROADMAP。

### Testing

- `packages/ui/src/hooks/__tests__/group-messages.test.ts`：9 个 case 覆盖
  `groupMessagesByVisit` 全部分支（全当前 / 全旧 / 混合 / 多旧 visit / 兼容无 visitId 旧消息 /
  currentVisitId=null 时的两种处理）。
- **21 test files / 315 tests 全绿**（+9 新测试），lint 0 error，typecheck 0 error。

---

## [v0.2.3] · 修漏 + 精化 Prompt · "真正能工作的记忆"

> v0.2.1 落地了记忆层的完整骨架（aux、反思、召回、命令、UI），但真机跑起来之后
> 暴露了两个必须修的问题：
>
> 1. **刷新页面后 Agent 完全失忆**——用户在同一 URL 下聊 2-3 轮，刷新再问"上次聊到哪"，
>    Agent 毫无印象。根因是 `episodes_msg` 表在**生产代码路径零写入**
>    （`memory.remember({type:'message'})` 没有任何调用点），违背 ROADMAP §79 设计要求；
>    连锁导致反思 Job 永远 skipped、向量召回没有素材。
> 2. **模型不会主动用记忆 tool**——`set_active_goal` / `add_todo` / `remember_persona`
>    的 description 都只在讲"这个 tool 做什么"，没讲"什么时候应该调"；模型自然不会
>    主动维护 WorkingMemory。前一版 `remember_persona` 被误用为"写自我设定"也反映了同一问题。
>
> 本版本 **先修数据链（让记忆真的能存进去）**，**再精化 Prompt（让模型知道什么时候用）**。

### Added

- **消息持久化**（`useStreamingChat` · `persistMessage` port）
  - 每条 user / assistant 消息在成功产生时调用 sidebar 注入的 `persistMessage` 落入
    `episodes_msg`，带上 `visitId / canonicalUrl / domain / orderInVisit / role`。
  - 失败静默（打 warn，不阻塞聊天）；`persistMessage` 未注入时完全退化到 v0.1 行为。
  - ui 包不反向依赖 memory：`persistMessage` 是一个 `{role, content}` 鸭子类型 port。
- **刷新时 rehydrate 三段式 fallback**（`sidebar/index.tsx`）
  - 档 1 · `WorkingMemory`：由 `WorkingMemorySource` 在 agent.run 组装 system prompt 时自动注入，无需额外动作。
  - 档 2 · `近期消息`：sidebar mount 时按 `canonicalUrl` 跨 visit 拉 `episodes_msg` 最近 10 条（5 轮）、3000 字上限，按 `timestamp` 升序（老→新），前置到 `useStreamingChat.initialHistoryForLLM`。
  - 档 3 · `向量召回`：不在 bootstrap 手动触发；由 `RelevantMemorySource` 在用户提问时按需召回。
- **关键 UX 设计**（符合"像真正的助手一样、不要把状态贴脸上"）
  - `initialHistoryForLLM` 只前置到给 LLM 的 `history`，**不进入** UI 的 `messages[]`。
  - 用户看不到"上次对话"的卡片/消息；但 Agent 能自然接续（例："我们刚才在看你发的这篇 agent loop 文章，聊到了反思调度——你想从哪里继续？"）。

### Changed · Prompt 全面升级（让记忆真的被用起来）

- **主 system prompt**（`DEFAULT_CHAT_SETTINGS.systemPrompt`）升级为"工作方式多段守则"：
  - "像真正的助手一样工作"：不把内部状态贴在对话里；不说"根据我的记忆系统..."、"让我查 WorkingMemory..."、"我调用 tool X 了"。直接给结果。
  - "主动维护 WorkingMemory"：跨多轮任务自动 `set_active_goal`，3-5 步用 `set_todos` 规划。
  - "主动维护长期指令"：稳定偏好/身份/风格写 `remember_persona`；转译为"对自己的指令"。
  - "自然接续上次对话"：有线索直接续；无线索坦诚说（"我这边没有上次的记录，你能简单说一下我们聊到哪了吗？"），不编造。
  - "页面内容优先"：需要引用原文/代码/数据时主动 `read_page_content`。
- **tool description 升级**（覆盖全部 WorkingMemory / 记忆相关 tool）：
  - `set_active_goal`：明确列出"跨多轮任务、用户明确研究 X"等主动触发时机；也明确"一次性问答不触发"。
  - `add_todo`：说明"有 activeGoal 后才加 TODO"；"多条时优先 `set_todos` 一次写"。
  - `remember_persona`：大篇幅说明与 WorkingMemory 的边界，多示例展示"用户背景 → Agent 规则"转译（v0.2.2 语义转向的延续）。
  - `recall_memory`：主动触发时机 + query 写法建议（10-30 字，核心实体）。
  - `get_working_memory`：说明"大部分时候 system 段已自动注入，无需显式调"。
  - `set_todos / update_todo / complete_todo / clear_todos`：补全几乎为空的参数 description（此前 LLM 只能靠字段名推断）。

### Testing

- `packages/memory/src/__tests__/dexie-store.test.ts` 新增 rehydrate 核心能力测试：
  跨 visit 按 `canonicalUrl` 召回 `type:'message'` 记录，验证 role/visitId/orderInVisit 等
  元数据完整保留。
- **20 test files / 303 tests 全绿**，lint 0 error，typecheck 0 error。

### Not Changed

- `MemoryStore` 接口契约（remember / recall 签名 100% 向后兼容）。
- Dexie schema（无 migration）。
- 向量召回链路。

### 已知限制 / 下一步

- 本期不做"跨 visit 边界提示"（消息间不插 `—— 上次访问 ——` 分隔）。如果发现模型把多次访问的对话混淆当作同一轮，再补。
- UI 层 tool-call 可观测性（v0.2.3+ ROADMAP）仍未做——但本期的 system prompt 守则已让模型"像真正的助手一样"工作，部分对冲了 tool-call 不可见的问题。

---

## [v0.2.2] · Persona 语义转向：从"用户画像"到"Agent 长期指令"

> v0.2.1 实际跑起来后发现一个设计偏差：`remember_persona` tool 被模型自发用来
> 写"我是小瑾，用户专属的文档助手..."这类**自我设定**，而原设计把 Persona 定位为
> "关于用户的稳定事实"。两类内容混在同一张表里，注入 prompt 时话术也不顺。
>
> 本次小版本不改数据 schema，仅做**语义重定向**：Persona = Agent 应当长期遵守的指令 / 行为规则。
> 同一条记忆既可以承载"称呼用户为小瑾"，也可以承载"你的身份是小瑾的文档助手"——
> 统一用"写给 Agent 自己的陈述/祈使句"表达，模型更容易产出正确内容，prompt 注入也更直接。

### Changed

- **`remember_persona` tool description 重写**：明确要求 content 是"写给 Agent 的长期指令"，
  并提供多个转译示例（用户背景 → Agent 行为规则）。
- **`PersonaSource` 注入话术**：从"# 关于用户的长期记忆（个性 / 偏好）"改为
  "# 你的长期指令（用户已确认的行为规则）"，提醒模型持续遵守。
- **反思 Job `persona_extraction` prompt 升级**：不再抽取"用户偏好/事实"，改为归纳
  "Agent 应如何长期服务用户的规则"。用户说"我是前端" → 产出"回答时默认使用前端语境举例"
  而不是"用户是前端工程师"。
- **UI 文案同步**：
  - PersonaReviewBanner 标题从"N 条新的个性记忆待审核"改为"N 条新的长期指令待确认"；
    按钮从"接受 / 拒绝"改为"采纳 / 忽略"；图标从 🧠 改为 📌。
  - 配置页 MemoryTab：记忆层介绍将 Persona 释义从"个性"改为"Agent 长期指令"；
    "Persona 自动确认阈值"改为"长期指令自动采纳阈值"；
    "Persona 审核"卡片改为"长期指令审核"，文案说明来源（反思归纳 / remember_persona）。
- **`PersonaRecord.content` 注释**：示例从"用户偏好 TypeScript"改为
  "称呼用户为小瑾 / 回答时使用结构化要点 / 默认把 TS 理解为 TypeScript 不要反问"。

### Unchanged

- 数据 schema 零变更：`PersonaRecord` 字段照旧，Dexie 版本不升，已有数据兼容。
- `addPersonaCandidate` / `updatePersona` / `listPersonas` 等 API 接口签名照旧。
- 审核流程照旧（pending → 用户批 → confirmed）。
- 反思 Job 调度、向量召回、WorkingMemory 等其它能力完全不受影响。

### Migration

- 老数据（如果 v0.2.1 期间已沉淀过"关于用户"风格的 Persona）继续有效；模型只是会读到
  一份措辞略不同的 system 段，仍然能表达一致的意图。如需重新审视，可在 sidebar banner
  或配置页人工确认/忽略。

### Testing

- `phase2-sources.test.ts` 更新 PersonaSource 断言：新增对 system 段标题"长期指令"的校验。
- `reflection.test.ts` 更新 parsePersonaOutput 与 persona_extraction 用例的 candidate 文本，
  示例化新的"指令"格式（例：默认使用 TypeScript 进行代码示例 / 回答时采用前端语境举例）。
- 20 test files / 302 tests 全绿，lint 0 error，typecheck 0 error。

---

## [v0.2.1] · 进行中 · Phase 2 记忆层高级能力

> 在 v0.2.0 记忆层基础设施之上实装"高级能力"：辅助 LLM 调用链、反思 Job 执行器、
> 召回链路、命令层（/recall、/topic、/new 语义重构）、Persona 审核 UI、
> WorkingMemory 卡片。至此"类人脑分层记忆"从骨架变为可运行的闭环。

### Added

- **辅助 LLM 调用链（`@doc-assistant/agent/aux`）**
  - `collectText(stream)`：把流式 `chat()` 消费为纯文本，忽略 reasoning/tool-call，
    规范化 AbortError / ProviderError / AUX_EMPTY_RESPONSE。
  - `callAuxIntent(aux, { userMessage, historyHint })`：召回链的 "精判" 环节；
    宽松解析 `ANSWER: yes/no + CONFIDENCE: 0-1`；失败降级为 no（不抛到主对话）。
  - `identifySessionTopic({ aux, memory, visitId, recentMessages })` +
    `shouldIdentify(userMsgCount, interval=4)`：每 N 轮触发一次主题识别；
    JSON 宽松解析 `{currentTopic, tags, stage}`，带 history 审计（最多 20 条）。
- **反思 Job 执行器与调度器（`@doc-assistant/agent/reflection`）**
  - `ReflectionRunner`：
    - `visit_summary`：根据该 visit 的 episodes_msg 生成 200 字内摘要 + 可选 embedding，
      落 `episodes_visit_summary` 表；embedding 失败时不阻塞入库。
    - `persona_extraction`：抽取稳定偏好/事实，dedupe 命中 +hitCount，status=pending
      等待用户审核。
    - `persona_conflict_check`：v0.2.1 占位（v0.2.2+ 实装）。
  - `ReflectionScheduler`：
    - `runPending()`：串行执行 pending 任务（默认 maxTasksPerRun=6）；
      失败 < maxAttempts 回 pending，达到 maxAttempts 置 failed。
    - `registerOnPageVisitEnd(pvm)`：订阅 PageVisit 结束，自动登记 3 条反思任务并尝试立即跑。
    - running 标志位避免并发重入。
  - **SW alarm 与 sidebar 的协同**：alarm 触发 → SW 广播 `REFLECTION_SCAN_TICK` →
    在线 sidebar 调 `runPending()`。选择"SW 只唤醒、sidebar 执行"的稳妥方案，
    规避 SW 与 sidebar IndexedDB 潜在的同源隔离风险。
- **召回链路（`@doc-assistant/agent/context`）**
  - `detectRecallTrigger`：中英双语正则粗判（"上次/之前/还记得/last time/..."）。
  - `recallMemory({ memory, aux }, { query, mode })`：代码粗判 → aux 精判 → 向量 topK → 邻居拼接。
    mode='explicit' 绕过粗判+精判（用于 /recall 和 tool 主动调用）。
  - `RelevantMemorySource` (priority=40)：自动召回路径，命中后生成带邻居消息的 system 段。
  - `buildDefaultPhase2_1Sources` + `createChatAgent({ phase2: true, auxLLM })`：
    传 auxLLM 自动启用 Phase2-1 源组合。
- **新增 tool（`@doc-assistant/tools`）**
  - `recall_memory`：主 LLM 主动召回（默认 mode=explicit）。
  - `remember_persona`：用户显式声明偏好时写 confirmed Persona（reviewedByUser=true,
    source.extractedBy='user_explicit'）。
  - `buildPhase2Tools(deps)` 升级为动态：根据 deps 能力按需注册 10~12 个 tool。
- **斜杠命令（`@doc-assistant/ui/commands`）**
  - `/new`（重构）：清 UI + 新 visitId；**不**清 WorkingMemory/Persona/Episodic。
  - `/recall <关键词>`：走 `triggerRecall` 钩子；空参给出用法提示；
    命中后结果以非流式 assistant 消息形式追加到聊天流（`appendAssistantNote`）。
  - `/topic [<文本>]`：有参 setSessionTopic；无参 triggerTopicIdentify。
  - 支持带参：`SlashCommand.execute(ctx, rawArgs?)`；`SlashCommandContext` 扩展
    5 个可选能力；`SlashCommandPlugin` 正则与参数解析升级。
- **UI 组件（`@doc-assistant/ui/components`）**
  - `PersonaReviewBanner`：sidebar 顶部折叠条，pending Persona 一键接受/拒绝；
    对话结束后延迟 3s 刷新；可跳转配置页批量管理。
  - `WorkingMemoryCard`：sidebar 顶部折叠卡片，显示 activeGoal + TODO 进度 + 状态图标；
    5s 轮询 + 对话结束立即刷新。
- **WorkingMemory 7 个细粒度 tool**（早于批次 3 加入，记录于此便于检索）：
  `get_working_memory` / `set_todos` / `add_todo` / `update_todo` / `complete_todo` /
  `clear_todos` / `set_active_goal`。

### Changed

- `createChatAgent` 新增 `auxLLM` 和 `relevantMemory` 选项；phase2=true + auxLLM 存在
  时自动升级为 Phase2-1 源集合（加入 RelevantMemorySource）。
- `BootstrapResult` 暴露 `auxLLM / embeddingProvider / reflectionScheduler`，供 sidebar
  注入 slash 命令回调。
- `MessageType` 新增 `REFLECTION_SCAN_TICK` + `ReflectionScanTickMessage`。
- `useStreamingChat` 新增 `appendAssistantNote(content)`：向聊天流追加非流式 assistant 消息。
- sidebar `SidebarApp` 装配 4 个 slash 命令回调（startNewVisit / recall / topic identify / topic set）
  与 3 个审核能力（getPendingPersonas / onConfirmPersona / onRejectPersona）。

### Testing

v0.2.1 净增 **8 个测试文件、95+ 个测试用例**：
- `packages/agent/src/__tests__/aux.test.ts`（31）
- `packages/agent/src/__tests__/reflection.test.ts`（21）
- `packages/agent/src/__tests__/recall.test.ts`（18）
- `packages/tools/src/__tests__/working-memory.test.ts`（21）
- `packages/tools/src/__tests__/recall-persona-tools.test.ts`（12）
- `packages/ui/src/commands/__tests__/commands.test.ts`（12）

总计 **20 test files / 302 tests** 全绿，lint 0 error。

---

## [v0.2.0] · 进行中 · Phase 2 记忆层基础设施

> 本版本引入"类人脑分层记忆"架构的基础设施，完成从"聊天窗口即上下文"到"按需组装上下文"
> 的思维范式切换。相关讨论定稿见 `docs/ROADMAP.md §2`。

### Added

- **三套 Provider 配置**：`MAIN_PROVIDER_CONFIG` / `AUX_PROVIDER_CONFIG` /
  `EMBEDDING_PROVIDER_CONFIG`，辅助与 embedding 均支持"复用主 Provider"开关。
- **`@doc-assistant/provider`**：新增 `EmbeddingProvider` 接口与 `QwenEmbeddingProvider`
  实现（OpenAI 兼容 `/embeddings` 端点，支持 `text-embedding-v2`/`v3`，单次 batch ≤ 25）。
- **`@doc-assistant/memory`**：`DexieMemoryStore` 完整落地
  - 6 张表：`episodes_msg` / `episodes_visit_summary` / `persona` / `session_topics`
    / `working_memories` / `reflection_tasks` / `page_visits`
  - 纯 JS 余弦相似度 + Top-K 召回（`< 5000` 条量级内存扫足够）
  - WorkingMemory LRU 软 TTL 与归档到 `episodes_visit_summary` 的转换
  - 集成 `shared.redactSensitive` 做敏感信息过滤
- **`@doc-assistant/agent`**：
  - `PageVisitManager`：UI 边界的统一抽象（替代 session 概念），管理
    visit 启停、URL 变化切换、`/new` 命令重启、订阅事件
  - 3 个新 ContextSource：`PersonaSource`（60）、`SessionTopicSource`（55）、
    `WorkingMemorySource`（50）；工厂函数 `buildDefaultPhase2_0Sources`
  - `createChatAgent` 新增 `phase2: boolean` 开关
- **`@doc-assistant/shared`**：
  - `url-normalize`：`canonicalizeUrl` / `normalizeUrlString` / `extractDomain`，
    canonical/og:url 优先 + 剥离 UTM/fbclid/gclid/hash/结尾斜杠
  - `sensitive-filter`：`redactSensitive` 支持 email / 手机号 / 身份证 / API Key
    （sk-/ghp_/AKID/JWT 等）/ 信用卡号，默认启用
  - `clampMaxTurns` 辅助函数（`[3, 15]` 夹取）
- **配置页 Tab 重构**：
  - 基础：主 Provider + 对话行为 + 测试连接
  - 记忆：辅助 Provider / Embedding Provider（含"复用主模型"开关）/ 敏感过滤 /
    反思 Job / WorkingMemory TTL / Persona 自动确认阈值
  - 高级：`maxTurns`（3~15，默认 8）
  - 调试：预留（日志、审计、数据导出）
- **`ProviderConfigForm`** 复用组件：统一 Provider 配置的 UI（baseURL +
  model + apiKey + useMain 开关）
- **Service Worker**：`manifest.json` 新增 `alarms` 权限；注册
  `doc-assistant.reflection-scan` alarm（60 分钟周期）。v0.2.0 占位，v0.2.1
  实装扫描/执行。
- **v0.1 → v0.2 自动迁移**：bootstrap 检测旧 `QWEN_CONFIG` 时自动迁移到
  `MAIN_PROVIDER_CONFIG`，用户无感升级。

### Changed

- **Agent Loop 最后一轮兜底（纯 A 方案）**：`packages/agent/src/loop.ts`
  - 默认 `maxTurns` 从 5 提升到 8（可在配置页调整，范围 `[3, 15]`）
  - 最后一轮强制**不传 tools**，并在 messages 末尾追加临时 system 提醒
    "已达到工具调用上限，请基于已有信息给出最终回答"
  - 最后一轮若 LLM 仍返回 `tool-call`，代码**忽略**（不 yield、不执行、不 push）
  - 最后一轮完全无输出时 yield `error` + `finish:error`，UI 显示"网络不佳，
    请检查网络或查看日志"（不做假文字兜底）
- **MemoryRecord 类型扩展**：`type` 联合追加 `'persona' | 'visit_summary'`；
  新增可选字段 `visitId` / `orderInVisit` / `canonicalUrl` / `role`；
  旧类型（`'message' | 'summary' | 'fact' | 'reference'`）保留兼容
- **MemoryStore 接口扩展**：`remember/recall` 签名不变；新增可选方法
  `getWorkingMemory` / `setWorkingMemory` / `touchWorkingMemory` /
  `archiveStaleWorkingMemories` / `listPersonas` / `addPersonaCandidate` /
  `updatePersona` / `setSessionTopic` / `getSessionTopic` /
  `enqueueReflection` / `listPendingReflections` / `updateReflection` /
  `recordPageVisit` / `close`。`NullMemoryStore` 提供 no-op 兜底。
- **AgentInvokeContext**：`page` 新增可选 `canonicalUrl` / `domain`；顶层新增
  可选 `visitId`；由 sidebar 在调用 Agent 前注入，用于 Phase2 ContextSource

### Infrastructure

- **ESLint**：memory 层解除 `dexie` 约束（仅限 `packages/memory/**`）；Agent / Tools
  的约束完全不动
- `packages/memory/package.json` 新增依赖 `dexie@^4`；devDependency `fake-indexeddb@^6`
- 测试总量从 44 提升到 **187**（新增 ~143 个）

---

## [v0.1.1] · 2026-04-18 · Sidebar 真实页面可用性修复

> 本次修复集中解决 v0.1.0 在真实宿主页面下的若干阻塞性问题，
> 所有修复分析、原理与验证步骤沉淀在
> [`docs/TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)。
> 下方每条条目标注了对应章节号 `[TS §N]` 方便回查。

### Fixed

- **输入框无法打字**：Lexical 在 Shadow DOM 内因 `window.getSelection()`
  被 shadow 边界截断导致光标定位失败。新增 `patch-shadow-selection`
  在 React 挂载前包装 `window.getSelection`，当选区 anchorNode 落在
  已注册 shadowRoot 内时返回 `shadowRoot.getSelection()`。`[TS §1]`

- **Tool-calling 第一轮后无回复（核心问题）**：`runAgentLoop` 之前把
  AI SDK 每轮 HTTP 请求的 `finish` chunk 透传到 UI 层，`useStreamingChat`
  一看到 `finish` 就 `break`，触发 AsyncGenerator `return()` 反向终止
  loop，tool 来不及执行、第二轮 LLM 请求从不发起。修为：loop 内部吞
  掉中间轮次的 finish，只在整段结束时合成一个 finish 透传给 UI。
  `ChatChunk.finish` 补充语义注释。`[TS §2]`

- **构建产物在宿主页面域下 404**：Vite 默认 `base: '/'`，其
  `__vitePreload` 辅助函数生成 `<link rel="modulepreload" href="/assets/xxx.js">`，
  被宿主页面 origin 解析成 `https://宿主域/assets/xxx.js` 全部 404。
  `vite.config.ts` 设置 `build.modulePreload: false`，走 dynamic import
  自己的相对路径解析。`[TS §3]`

- **LLM 请求被 CORS 拦截**：manifest 新增 `host_permissions`
  声明千问 API 域（`dashscope.aliyuncs.com`、`dashscope-intl.aliyuncs.com`），
  允许 content script 跨源请求。`[TS §4]`

- **输入卡顿 + 宿主页面 404.thml 请求风暴**：`ChatPanel` 的
  `pageSummary` 原先每次渲染都同步跑 `runIdentityPipeline + runContentPipeline`，
  Lexical 每敲一键都触发全量 DOM 提取，在技术博客这种中等尺寸页面上
  造成秒级延迟，并附带触发宿主页面 IntersectionObserver 误判。
  改为 `useMemo([visible])`，只在面板显隐切换时重算；`send` 时
  `buildInvokeContext` 仍会即时取最新摘要。`[TS §5]`

- **划词引用无反应**：`InsertReferencePlugin` 与 `ActionsBridge` 的
  `useEffect` 执行顺序不可保证，前者尝试写入 `actionsRef.current`
  时后者尚未设值，后者后续又覆盖成空占位函数。改为
  `ActionsBridge.insertReference` 作为闭包从 `insertRef` 实时读取。
  同时 `useSelectionBridge` 从"接受函数"改为"接受 getter"，
  消除异步 register 时的闭包锁死问题。`selection-toolbar`
  改用 `document.getSelection()` 明确拿宿主页面选区，不依赖 patch 行为。
  `[TS §6]`

- **对话框样式"透明化"**：尝试加 `contain: layout style size` 后
  `backdrop-filter` 与 `background: rgba(...)` 整体失效（`contain:size`
  以 0×0 作为内容布局基准）。移除相关 containment 声明。`[TS §7]`

### Added

- `apps/extension/src/sidebar/patch-shadow-selection.ts` · Lexical
  shadow DOM 兼容补丁
- `packages/shared/src/chat.ts` · `ChatChunk.finish` 增加语义注释
- `packages/agent/src/loop.ts` · 文件头注释明确"finish 不透传"约定

### Changed

- `packages/agent/src/context/page-context.ts` · 提示语强化，
  让 LLM 更主动地在需要细节时调用 `read_page_content`
- `packages/tools/src/definitions/read-page-content.ts` · 失败路径
  改为 `throw`，让 `loop.executeTool` 统一标记 `isError`

### Infrastructure

- shadow host 加 `pointer-events: none`，`Panel` / `CollapsedFab`
  显式 `pointer-events: auto` 恢复命中测试

---

## [v0.1.0] · 2026-04-17 · MVP 首版

详见 [`README.md`](../README.md) 与
[`.codebuddy/plans/doc-assistant-mvp-v0_1_9c7dd683.md`](../.codebuddy/plans/doc-assistant-mvp-v0_1_9c7dd683.md)。
