/**
 * Sidebar 启动装配
 * ---------------------------------------------
 * 读取 chrome.storage 的 Provider 配置 → 构造 QwenProvider → 装配 ChatAgent →
 * 返回给 SidebarApp 使用。
 *
 * 若配置缺失（用户未填 apiKey），返回一个占位 Agent，首次发送时提示跳转配置。
 */
import {
  createLogger,
  createTypedStorage,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_QWEN_CONFIG,
  STORAGE_KEYS,
  type StorageSchema,
  type ChatSettings,
  type QwenConfig,
} from '@doc-assistant/shared';
import { QwenProvider } from '@doc-assistant/provider';
import { NullMemoryStore } from '@doc-assistant/memory';
import { buildDefaultMVPTools } from '@doc-assistant/tools';
import { createChatAgent, type Agent } from '@doc-assistant/agent';

const logger = createLogger('extension:sidebar:bootstrap');

export interface BootstrapResult {
  agent: Agent;
  chatSettings: ChatSettings;
  qwenConfig: QwenConfig;
  /** 是否缺失必要配置（apiKey 未填） */
  missingConfig: boolean;
}

export async function bootstrapAgent(): Promise<BootstrapResult> {
  const storage = createTypedStorage<StorageSchema>();

  const [qwenRaw, chatRaw] = await Promise.all([
    storage.get(STORAGE_KEYS.QWEN_CONFIG),
    storage.get(STORAGE_KEYS.CHAT_SETTINGS),
  ]);

  const qwenConfig = { ...DEFAULT_QWEN_CONFIG, ...(qwenRaw ?? {}) };
  const chatSettings = { ...DEFAULT_CHAT_SETTINGS, ...(chatRaw ?? {}) };

  const missingConfig = !qwenConfig.apiKey.trim();
  if (missingConfig) {
    logger.warn('未配置 API Key，Agent 将在首次发送时提示用户配置');
    // 为了让 Agent 在 UI 层仍能被 new/clear 等逻辑访问，这里也构造一个实例，
    // 但使用一个假的 apiKey；真正调用 LLM 时会抛错
    qwenConfig.apiKey = 'placeholder';
  }

  const llm = new QwenProvider(qwenConfig);
  const memory = new NullMemoryStore();
  const tools = buildDefaultMVPTools();

  const agent = createChatAgent({
    llm,
    memory,
    tools,
    systemPrompt: chatSettings.systemPrompt,
    maxHistoryChars: chatSettings.maxContextChars,
  });

  logger.info('ChatAgent 装配完成', {
    model: qwenConfig.model,
    enableThinking: qwenConfig.enableThinking,
    tools: tools.map((t) => t.name),
    missingConfig,
  });

  return { agent, qwenConfig, chatSettings, missingConfig };
}
