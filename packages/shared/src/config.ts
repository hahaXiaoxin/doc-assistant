/**
 * Provider 配置与 chrome.storage.local schema
 * ---------------------------------------------
 * v0.2 · 三套 Provider（main / auxiliary / embedding）+ MemorySettings
 * - 所有 Provider 的配置都存 chrome.storage.local
 * - API Key 严禁写日志、严禁写 IndexedDB
 *
 * 架构约定：
 * - `ProviderKind` 区分 LLM 提供方（qwen / openai / ...），新 Provider 扩展此联合
 * - `EmbeddingProviderKind` 区分 embedding 提供方，与 LLM 解耦
 * - 辅助模型（auxiliary）与 embedding 都支持 `useMain=true` 复用主 Provider 配置
 */

export const STORAGE_KEYS = {
  /** 当前启用的主 Provider kind */
  ACTIVE_PROVIDER: 'doc-assistant.active-provider',

  /** 主 Provider 配置（负责主对话） */
  MAIN_PROVIDER_CONFIG: 'doc-assistant.main-provider-config',

  /** 辅助 Provider 配置（主题识别/反思/Intent 精判；可复用主 Provider） */
  AUX_PROVIDER_CONFIG: 'doc-assistant.aux-provider-config',

  /** Embedding Provider 配置（向量化；可复用主 Provider） */
  EMBEDDING_PROVIDER_CONFIG: 'doc-assistant.embedding-provider-config',

  /** 通用对话设置（maxTurns 等） */
  CHAT_SETTINGS: 'doc-assistant.chat-settings',

  /** 记忆层设置（敏感过滤 / 反思 Job / WorkingMemory TTL 等） */
  MEMORY_SETTINGS: 'doc-assistant.memory-settings',
} as const;

/* ------------------------------------------------------------------ */
/* LLM Provider 配置（主 / 辅助通用结构）                              */
/* ------------------------------------------------------------------ */

/** LLM Provider 种类；未来扩展此联合即可（v0.6.0-beta.2 新增 deepseek） */
export type ProviderKind = 'qwen' | 'deepseek';

/** 千问可选模型（仅 UI 建议值，baseURL 允许任意字符串） */
export const QWEN_MODELS = ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen3-max'] as const;
// eslint-disable-next-line @typescript-eslint/ban-types
export type QwenModel = (typeof QWEN_MODELS)[number] | (string & {});

/** DeepSeek 可选模型（仅 UI 建议值） */
export const DEEPSEEK_MODELS_SUGGESTED = ['deepseek-chat', 'deepseek-reasoner'] as const;
// eslint-disable-next-line @typescript-eslint/ban-types
export type DeepSeekModel = (typeof DEEPSEEK_MODELS_SUGGESTED)[number] | (string & {});

/**
 * 通用 LLM Provider 配置
 * ---
 * 统一的 `baseUrl + model + apiKey` 规范，兼容云端与本地模型。
 */
export interface LLMProviderConfig {
  kind: ProviderKind;
  /** 兼容 OpenAI 协议的端点 */
  baseURL: string;
  /** 模型名称（自由文本，遵循具体 Provider 命名） */
  model: string;
  /** API Key（敏感，严禁日志/IDB） */
  apiKey: string;
  /** 是否启用思考模式（qwen 特有，其它 Provider 忽略） */
  enableThinking?: boolean;
}

/**
 * 辅助/Embedding Provider 的"复用主 Provider"开关
 * 存储形如 `{ useMain: true }` 或完整 `LLMProviderConfig`
 */
export type ProviderConfigOrRef<T> = { useMain: true } | T;

/** 判定 ProviderConfigOrRef 是否处于"复用主 Provider"状态 */
export function isUseMain<T>(v: ProviderConfigOrRef<T> | undefined): v is { useMain: true } {
  return !!v && typeof v === 'object' && (v as { useMain?: boolean }).useMain === true;
}

/* ------------------------------------------------------------------ */
/* Embedding Provider 配置                                             */
/* ------------------------------------------------------------------ */

/** Embedding Provider 种类 */
export type EmbeddingProviderKind = 'qwen-embedding';

/** 千问可选 embedding 模型（维度与模型绑定，换模型需清库重建） */
export const QWEN_EMBEDDING_MODELS = ['text-embedding-v2', 'text-embedding-v3'] as const;
// eslint-disable-next-line @typescript-eslint/ban-types
export type QwenEmbeddingModel = (typeof QWEN_EMBEDDING_MODELS)[number] | (string & {});

export interface EmbeddingProviderConfig {
  kind: EmbeddingProviderKind;
  baseURL: string;
  model: string;
  apiKey: string;
  /** 向量维度，v2=1536 / v3=1024；用户换模型时 UI 会警告 */
  dimension: number;
}

/* ------------------------------------------------------------------ */
/* 默认配置                                                            */
/* ------------------------------------------------------------------ */

/** 默认主 Provider 配置（kind=qwen） */
export const DEFAULT_MAIN_PROVIDER_CONFIG: LLMProviderConfig = {
  kind: 'qwen',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen-plus',
  apiKey: '',
  enableThinking: true,
};

/**
 * DeepSeek 主 Provider 默认值（v0.6.0-beta.2 新增）
 * ---------------------------------------------
 * UI 在用户把主 Provider 切到 DeepSeek 时使用。默认用 deepseek-chat；
 * 切到 deepseek-reasoner 由用户显式选择。`enableThinking` 默认 false（UI 展示层不强制 R1）。
 */
export const DEFAULT_DEEPSEEK_PROVIDER_CONFIG: LLMProviderConfig = {
  kind: 'deepseek',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: '',
  enableThinking: false,
};

/** 默认辅助 Provider 配置：默认"复用主 Provider" */
export const DEFAULT_AUX_PROVIDER_CONFIG: ProviderConfigOrRef<LLMProviderConfig> = {
  useMain: true,
};

/** 默认 Embedding Provider 配置：默认"复用主 Provider"的 baseURL+apiKey，model 用 v2 */
export const DEFAULT_EMBEDDING_PROVIDER_CONFIG: ProviderConfigOrRef<EmbeddingProviderConfig> = {
  useMain: true,
};

/** 非 useMain 时 embedding provider 的填空默认值（UI 取消"复用主 Provider"时使用） */
export const DEFAULT_EMBEDDING_PROVIDER_CONFIG_FALLBACK: EmbeddingProviderConfig = {
  kind: 'qwen-embedding',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'text-embedding-v2',
  apiKey: '',
  dimension: 1536,
};

/* ------------------------------------------------------------------ */
/* 对话设置                                                            */
/* ------------------------------------------------------------------ */

export interface ChatSettings {
  /** 发送给 LLM 的 system prompt */
  systemPrompt: string;
  /** 发送消息时最多携带多少字符的上下文（粗略字符估算） */
  maxContextChars: number;
  /**
   * Agent Loop 最大 tool-call 轮数（默认 8，配置页范围 [3,15]）
   * 最后一轮强制不传 tools 兜底，见 packages/agent/src/loop.ts
   */
  maxTurns: number;
}

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

/** Agent Loop maxTurns 的合法范围 */
export const MAX_TURNS_MIN = 3;
export const MAX_TURNS_MAX = 15;

/** 将任意值夹到 [MIN, MAX] 之间，供 UI/bootstrap 防护输入 */
export function clampMaxTurns(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : DEFAULT_CHAT_SETTINGS.maxTurns;
  if (v < MAX_TURNS_MIN) return MAX_TURNS_MIN;
  if (v > MAX_TURNS_MAX) return MAX_TURNS_MAX;
  return v;
}

/* ------------------------------------------------------------------ */
/* 记忆层设置                                                          */
/* ------------------------------------------------------------------ */

export interface MemorySettings {
  /** 启用敏感信息过滤（email / 手机号 / 身份证 / apiKey / 信用卡号 → [REDACTED]） */
  sensitiveFilterEnabled: boolean;
  /** 启用反思 Job（visit_summary 生成 / Persona 候选抽取） */
  reflectionEnabled: boolean;
  /** WorkingMemory 软 TTL 天数，达到后归档而非立即删 */
  workingMemoryTtlDays: number;
  /** Persona 自动确认门槛：反思命中同一条 ≥ 该次数则自动 confirmed */
  personaAutoConfirmHits: number;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  sensitiveFilterEnabled: true,
  reflectionEnabled: true,
  workingMemoryTtlDays: 30,
  personaAutoConfirmHits: 3,
};

/* ------------------------------------------------------------------ */
/* chrome.storage.local 的强类型 schema                                */
/* ------------------------------------------------------------------ */

/** chrome.storage.local 的强类型 schema 映射 */
export interface StorageSchema extends Record<string, unknown> {
  [STORAGE_KEYS.ACTIVE_PROVIDER]: ProviderKind;
  [STORAGE_KEYS.MAIN_PROVIDER_CONFIG]: LLMProviderConfig;
  [STORAGE_KEYS.AUX_PROVIDER_CONFIG]: ProviderConfigOrRef<LLMProviderConfig>;
  [STORAGE_KEYS.EMBEDDING_PROVIDER_CONFIG]: ProviderConfigOrRef<EmbeddingProviderConfig>;
  [STORAGE_KEYS.CHAT_SETTINGS]: ChatSettings;
  [STORAGE_KEYS.MEMORY_SETTINGS]: MemorySettings;
}
