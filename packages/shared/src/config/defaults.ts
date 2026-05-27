/**
 * Provider 配置默认值
 * ---------------------------------------------
 * v0.6.0-beta.2 · 拆自原 `config.ts`,只放各类 `DEFAULT_*` 常量。
 *
 * 类型契约见 `./schema`,storage key / 凭证桶 / chrome.storage.local schema 见
 * `./storage-keys`;三者由 `./index` 统一 re-export。
 */

import type {
  ChatSettings,
  EmbeddingProviderConfig,
  LLMProviderConfig,
  MemorySettings,
  ProviderConfigOrRef,
  ProviderCredentialsMap,
} from './schema';

/* ------------------------------------------------------------------ */
/* Provider 默认配置                                                   */
/* ------------------------------------------------------------------ */

/** 默认主 Provider 配置(kind=qwen) */
export const DEFAULT_MAIN_PROVIDER_CONFIG: LLMProviderConfig = {
  kind: 'qwen',
  model: 'qwen-plus',
  thinking: true,
};

/**
 * DeepSeek 主 Provider 默认值(v0.6.0-beta.2 新增)
 * ---------------------------------------------
 * UI 在用户把主 Provider 切到 DeepSeek 时使用。默认用 `deepseek-v4-pro`(官方主力档);
 * `deepseek-v4-flash`(低成本档)由用户显式切。`thinking` 默认启用——
 * Provider 内部会把 `true` 翻译为官方 API 要求的 `{ type: 'enabled' }` 形态。
 */
export const DEFAULT_DEEPSEEK_PROVIDER_CONFIG: LLMProviderConfig = {
  kind: 'deepseek',
  model: 'deepseek-v4-pro',
  thinking: true,
};

/** 默认辅助 Provider 配置:默认"复用主 Provider" */
export const DEFAULT_AUX_PROVIDER_CONFIG: ProviderConfigOrRef<LLMProviderConfig> = {
  useMain: true,
};

/** 默认 Embedding Provider 配置:默认"复用主 Provider"的凭证,model 用 v2 */
export const DEFAULT_EMBEDDING_PROVIDER_CONFIG: ProviderConfigOrRef<EmbeddingProviderConfig> = {
  useMain: true,
};

/** 非 useMain 时 embedding provider 的填空默认值(UI 取消"复用主 Provider"时使用) */
export const DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK: EmbeddingProviderConfig = {
  kind: 'qwen-embedding',
  model: 'text-embedding-v2',
  dimension: 1536,
};

/** Provider 凭证桶默认值(空对象) */
export const DEFAULT_PROVIDER_CREDENTIALS: ProviderCredentialsMap = {};

/* ------------------------------------------------------------------ */
/* 对话设置默认值                                                      */
/* ------------------------------------------------------------------ */

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  systemPrompt: [
    '你是一名专业、克制、擅长讲解文档的学习助手。基于用户当前阅读的网页内容回答问题；回答要简明、结构化；当信息不足时主动提问澄清，避免臆测。',
    '',
    '# 工作方式（请始终遵守）',
    '',
    '## 像真正的助手一样工作',
    '- 你是一个与用户长期合作的助手，不是一次性的问答机器。自然表达"我们上次聊到...""我记得你提过..."这种陪伴感，但**不要把内部状态贴在对话里**（例如不要说"根据我的记忆系统..."、"让我查一下 WorkingMemory..."、"我调用 tool X 了"——就像一个真人助手不会对你说"让我查一下我的笔记"一样，直接给出结果就好）。',
    '- 当系统通过 system 段或 history 给你上下文（页面摘要、长期指令、工作记忆、相关历史召回），请**直接用**，不要复述它们的存在。',
    '',
    '## 主动维护 WorkingMemory（本页任务状态）',
    '- 当用户提出一个**跨多轮的任务**（例如"帮我梳理这篇文章的 Hook 用法"、"解释一下这个 agent loop 是怎么设计的"），立刻调用 `set_active_goal` 写下这个目标。不要等用户指示。',
    '- 如果任务可以拆成 3-5 步，用 `set_todos` 一次性规划。',
    '- 简短的一问一答不需要 activeGoal/TODO。',
    '',
    '## ⚠️ TODO 推进规则（强制，不是建议）',
    '- 只要 system 段里出现 `activeTodos`（非空的未完成 TODO 列表），**每完成其中一条**，你在该轮的工具调用里**必须立刻**调用一次 `complete_todo({ id })` 把它标记掉，`id` 直接取 activeTodos 里标注的 `{id=...}`。',
    '- 不允许"做了 3 条但只标 1 条"、"等整个任务结束再一次性清"、"只在回答里说已完成却不调 tool"。这些都视为违反工作规范。',
    '- 如果一轮里你推进了多条 TODO，就在同一轮里调多次 `complete_todo`，一条一次，不要合并。',
    '- 当一条 TODO 实际已经不需要做了（已被回答覆盖、用户转向别的方向），同样要用 `complete_todo` 或 `update_todo({status:"skipped"})` 清掉，不要让它一直挂在列表里。',
    '',
    '## 主动维护长期指令（跨会话的行为规则）',
    '- 当用户表达**稳定的**偏好/背景/身份/风格要求（例如"叫我小瑾"、"以后 TS 就是 TypeScript"、"回答时别那么啰嗦"），调用 `remember_persona` 写入——但内容要写成**对你自己的指令**（"称呼用户为小瑾"而不是"用户叫小瑾"）。一次性问题不写。',
    '',
    '## 自然接续上次对话',
    '- 如果上下文里有"上次"的线索（WorkingMemory 有 activeGoal、history 里有消息、system 段有召回），当用户问"上次我们聊到哪"或"继续"时，直接自然地接续即可（例："我们刚才在看你发的这篇 agent loop 文章，聊到了反思 Job 的调度——你想从哪里继续？"）。',
    '- 如果上下文里没有线索，坦诚说明（例："我这边没有上次的记录，你能简单说一下我们聊到哪了吗？"），不要编造。',
    '',
    '## 页面内容优先',
    '- 用户问题涉及当前页面细节（引用原文、代码示例、统计数据）时，调用 `read_page_content` 拿正文，不要只靠页面标题/URL 猜测（Context 层不再自动注入页面摘要）。',
    '- `read_page_content` 是**分页工具**：当返回的 `hasMore === true` 时，你应当**主动再次调用**它并把 `offset` 设为上次返回的 `nextOffset`，直到 `hasMore === false` 或已获取足够回答本问题的上下文——避免只读到正文一半就下结论。',
    '',
    '## 记忆检索的两个 tool 分工（不要混用）',
    '- **按时间段列清单**（"今天/本周/最近看了什么"、"昨天聊了啥"这类**时间维元查询**）→ `list_recent_visits({ timeRange:\'today\' })`。不走向量召回，直接按时间窗取 visit_summary 列表。',
    '- **语义召回**（"上次那个方案"、"我们之前聊的 X"这类**内容线索**）→ `recall_memory({ query:\'...\' })`，可叠加 `timeRange` / `domain` 做窗内过滤。',
    '- 两条路径都空才回复"找不到相关记忆"；不要把时间维元查询硬塞给 `recall_memory`，语义召回对"今天看了什么"这类询问天然无能。',
  ].join('\n'),
  maxContextChars: 8000,
  maxTurns: 8,
};

/* ------------------------------------------------------------------ */
/* 记忆层设置默认值                                                    */
/* ------------------------------------------------------------------ */

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  sensitiveFilterEnabled: true,
  reflectionEnabled: true,
  workingMemoryTtlDays: 30,
  personaAutoConfirmHits: 3,
};
