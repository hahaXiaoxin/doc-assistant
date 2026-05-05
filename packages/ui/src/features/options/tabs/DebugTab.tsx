/**
 * DebugTab · 调试与日志(v0.6.0)
 * ---------------------------------------------
 * 内测工具台。提供:
 *
 * ① 日志级别切换(debug / info / warn / error)——影响当前 options 页运行时
 *    + 下次启动的 sidebar / SW / offscreen 日志级别
 * ② 查看最近 200 条日志(从 offscreen 拉取)
 * ③ 一键导出 debug.zip(含 memory.json + logs.json + sanitized-config.json + README.md)
 *
 * 实现要点:
 * - 记忆从 memory store(RemoteMemoryStore)读取,走 offscreen RPC
 * - 日志从 offscreen 拉取 LOG_EXPORT_REQUEST(最多 5000 条)
 * - Provider / ChatSettings / MemorySettings 从 TypedStorage 读取
 * - 所有敏感内容经 `sanitizeExportBundle` 处理后再 JSON 化
 * - zip 由 jszip 打包,浏览器侧通过 anchor 触发下载
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Empty,
  Radio,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import JSZip from 'jszip';
import {
  MessageType,
  STORAGE_KEYS,
  createLogger,
  getLogLevel,
  sanitizeExportBundle,
  sanitizeExportJson,
  setLogLevel,
  type ChatSettings,
  type EmbeddingProviderConfig,
  type ExportableBundle,
  type LLMProviderConfig,
  type LogExportRequest,
  type LogExportResponse,
  type LogLevel,
  type LogRpcEntry,
  type MemorySettings,
  type ProviderConfigOrRef,
  type StorageSchema,
  type TypedStorage,
} from '@doc-assistant/shared';
import type {
  MemoryStore,
  PersonaRecord,
  SessionTopicRecord,
  WorkingMemoryRecord,
} from '@doc-assistant/memory';

const logger = createLogger('ui:options:debug');

export interface DebugTabProps {
  memory: MemoryStore | null;
  storage: TypedStorage<StorageSchema>;
}

const LEVEL_OPTIONS: Array<{ value: LogLevel; label: string }> = [
  { value: 'debug', label: 'debug' },
  { value: 'info', label: 'info' },
  { value: 'warn', label: 'warn' },
  { value: 'error', label: 'error' },
];

/** 从 offscreen 拉取最近日志 */
async function fetchRecentLogs(limit = 5000): Promise<LogRpcEntry[]> {
  if (
    typeof chrome === 'undefined' ||
    typeof chrome.runtime === 'undefined' ||
    typeof chrome.runtime.sendMessage !== 'function'
  ) {
    return [];
  }
  const rpcId = `log-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const req: LogExportRequest = {
    type: MessageType.LOG_EXPORT_REQUEST,
    rpcId,
    limit,
  };
  try {
    const resp = (await chrome.runtime.sendMessage(req)) as LogExportResponse | undefined;
    if (!resp || !resp.ok) {
      logger.warn('LOG_EXPORT 响应异常', resp?.error?.message ?? 'no-response');
      return [];
    }
    return resp.entries ?? [];
  } catch (err) {
    logger.warn('LOG_EXPORT sendMessage 失败', (err as Error).message);
    return [];
  }
}

/** 从 memory store 收集所有可导出数据 */
async function collectMemorySnapshot(memory: MemoryStore | null): Promise<ExportableBundle['memory']> {
  if (!memory) return {};
  const [visitSummaries, personas, workings, topics] = await Promise.all([
    memory.listVisitSummaries({ limit: 500 }).catch((err: Error) => {
      logger.warn('listVisitSummaries 失败', err.message);
      return [] as Awaited<ReturnType<MemoryStore['listVisitSummaries']>>;
    }),
    memory.listPersonas().catch((err: Error) => {
      logger.warn('listPersonas 失败', err.message);
      return [] as PersonaRecord[];
    }),
    memory.listWorkingMemories({ limit: 200 }).catch((err: Error) => {
      logger.warn('listWorkingMemories 失败', err.message);
      return [] as WorkingMemoryRecord[];
    }),
    memory.listSessionTopics({ limit: 200 }).catch((err: Error) => {
      logger.warn('listSessionTopics 失败', err.message);
      return [] as SessionTopicRecord[];
    }),
  ]);
  return {
    episodes_visit_summary: visitSummaries,
    persona: personas,
    working_memories: workings,
    session_topics: topics,
  };
}

/** 触发浏览器下载 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DebugTab({ memory, storage }: DebugTabProps) {
  const [currentLevel, setCurrentLevel] = useState<LogLevel>(getLogLevel());
  const [recentLogs, setRecentLogs] = useState<LogRpcEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<{
    visitSummaries: number;
    personas: number;
    workings: number;
    topics: number;
  } | null>(null);

  const refreshStats = useCallback(async () => {
    if (!memory) return;
    try {
      const [vs, ps, wm, st] = await Promise.all([
        memory.listVisitSummaries({ limit: 500 }),
        memory.listPersonas(),
        memory.listWorkingMemories({ limit: 200 }),
        memory.listSessionTopics({ limit: 200 }),
      ]);
      setStats({
        visitSummaries: vs.length,
        personas: ps.length,
        workings: wm.length,
        topics: st.length,
      });
    } catch (err) {
      logger.warn('刷新统计失败', (err as Error).message);
    }
  }, [memory]);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const handleLevelChange = useCallback((level: LogLevel) => {
    setLogLevel(level);
    setCurrentLevel(level);
    message.success(`日志级别已切换为 ${level}(仅影响当前页)`);
  }, []);

  const handleLoadLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const entries = await fetchRecentLogs(200);
      setRecentLogs(entries);
      message.success(`已加载最近 ${entries.length} 条日志`);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const [main, aux, embedding, chat, memSettings, memSnapshot, logs] = await Promise.all([
        storage.get(STORAGE_KEYS.MAIN_PROVIDER_CONFIG) as Promise<LLMProviderConfig | undefined>,
        storage.get(STORAGE_KEYS.AUX_PROVIDER_CONFIG) as Promise<
          ProviderConfigOrRef<LLMProviderConfig> | undefined
        >,
        storage.get(STORAGE_KEYS.EMBEDDING_PROVIDER_CONFIG) as Promise<
          ProviderConfigOrRef<EmbeddingProviderConfig> | undefined
        >,
        storage.get(STORAGE_KEYS.CHAT_SETTINGS) as Promise<ChatSettings | undefined>,
        storage.get(STORAGE_KEYS.MEMORY_SETTINGS) as Promise<MemorySettings | undefined>,
        collectMemorySnapshot(memory),
        fetchRecentLogs(5000),
      ]);

      const now = Date.now();
      const bundle: ExportableBundle = {
        exportedAt: now,
        version: '0.6.0-beta.1',
      };
      const providers: NonNullable<ExportableBundle['providers']> = {};
      if (main) providers.main = main;
      if (aux) {
        providers.aux =
          'useMain' in aux && aux.useMain ? { useMain: true } : (aux as LLMProviderConfig);
      }
      if (embedding) {
        providers.embedding =
          'useMain' in embedding && embedding.useMain
            ? { useMain: true }
            : (embedding as EmbeddingProviderConfig);
      }
      if (providers.main || providers.aux || providers.embedding) {
        bundle.providers = providers;
      }
      if (chat) bundle.chatSettings = { ...chat };
      if (memSettings) bundle.memorySettings = { ...memSettings };
      if (memSnapshot) bundle.memory = memSnapshot;
      bundle.logs = logs;

      // 1. sanitized-config.json:仅 providers + settings(不含 memory/logs)
      const configOnly: ExportableBundle = {
        exportedAt: now,
        version: '0.6.0-beta.1',
      };
      if (bundle.providers) configOnly.providers = bundle.providers;
      if (bundle.chatSettings) configOnly.chatSettings = bundle.chatSettings;
      if (bundle.memorySettings) configOnly.memorySettings = bundle.memorySettings;
      const configJson = sanitizeExportJson(configOnly);

      // 2. memory.json:仅 memory 快照(已脱敏)
      const memoryJson = sanitizeExportJson({
        exportedAt: now,
        ...(bundle.memory ? { memory: bundle.memory } : {}),
      });

      // 3. logs.json:最近 5000 条日志(整体再过一次文本兜底)
      const logsJson = sanitizeExportJson({
        exportedAt: now,
        logs,
      });

      // 4. README.md
      const readme = [
        `# Doc Assistant Debug Bundle`,
        ``,
        `- 导出时间: ${new Date(now).toISOString()}`,
        `- 版本: ${bundle.version ?? 'unknown'}`,
        ``,
        `## 文件清单`,
        `- \`sanitized-config.json\`: Provider / ChatSettings / MemorySettings(已脱敏)`,
        `- \`memory.json\`: 记忆层快照(visit_summary / persona / working_memories / session_topics;已脱敏)`,
        `- \`logs.json\`: 最近 ${logs.length} 条运行日志`,
        ``,
        `## 脱敏说明`,
        `- API Key 一律替换为 [REDACTED:api_key]`,
        `- baseURL / URL 只保留 host,path 抹掉`,
        `- 对话原文 / persona 原文 / visit 摘要原文替换为长度占位符`,
        `- systemPrompt / activeGoal / todos / currentTopic / title 保留原文(排查方便)`,
        `- 最终 JSON 字符串经过 redactSensitiveText 兜底,sk-/ghp_/AKID 等硬敏感即便被塞进保留字段也会被替换`,
        ``,
        `排查问题时可附带本 zip;如有疑虑,可使用任何文本编辑器打开 JSON 手工审核后再分享。`,
      ].join('\n');

      const zip = new JSZip();
      zip.file('sanitized-config.json', configJson);
      zip.file('memory.json', memoryJson);
      zip.file('logs.json', logsJson);
      zip.file('README.md', readme);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

      const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
      downloadBlob(blob, `doc-assistant-debug-${stamp}.zip`);
      message.success('Debug 包已生成,开始下载');
    } catch (err) {
      logger.error('导出 debug 包失败', (err as Error).message);
      message.error(`导出失败:${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  }, [memory, storage]);

  const previewBundle = useCallback(() => {
    if (!memory) {
      message.warning('记忆层不可用,仅预览配置脱敏结果');
    }
    const preview = sanitizeExportBundle({
      exportedAt: Date.now(),
      providers: {
        main: {
          kind: 'qwen',
          baseURL: 'https://example.com/api/v1',
          model: 'qwen-plus',
          apiKey: 'sk-EXAMPLE',
        },
      },
    });
    // eslint-disable-next-line no-console
    console.info('[DebugTab] 脱敏预览', preview);
    message.info('已在控制台输出脱敏样例');
  }, [memory]);

  return (
    <>
      <Alert
        type="info"
        showIcon
        message="调试与审计(v0.6.0 内测)"
        description="此 Tab 用于内测阶段的问题排查。支持切换日志级别、查看最近日志、导出脱敏后的 Debug 包(Provider 配置 + 记忆 JSON + 运行日志)。"
        style={{ marginBottom: 16 }}
      />

      <Card title="日志级别" size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            当前级别:<Tag color="blue">{currentLevel}</Tag>(切换只影响当前 options 页)
          </Typography.Paragraph>
          <Radio.Group
            value={currentLevel}
            onChange={(e) => handleLevelChange(e.target.value as LogLevel)}
            options={LEVEL_OPTIONS}
            optionType="button"
            buttonStyle="solid"
          />
        </Space>
      </Card>

      <Card title="最近日志(来自 offscreen)" size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Space>
            <Button onClick={handleLoadLogs} loading={loadingLogs}>
              刷新最近 200 条
            </Button>
            <Typography.Text type="secondary">
              已加载:{recentLogs.length} 条
            </Typography.Text>
          </Space>
          {recentLogs.length === 0 ? (
            <Empty
              description="尚未加载日志(点上方按钮)"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <pre
              style={{
                maxHeight: 320,
                overflow: 'auto',
                background: '#f5f5f5',
                padding: 12,
                fontSize: 12,
                lineHeight: 1.5,
                borderRadius: 4,
                margin: 0,
              }}
            >
              {recentLogs
                .map(
                  (e) =>
                    `[${new Date(e.ts).toISOString()}] [${e.level}] [${e.module}] ${e.msg}`,
                )
                .join('\n')}
            </pre>
          )}
        </Space>
      </Card>

      <Card title="导出 Debug 包" size="small">
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Descriptions column={2} size="small">
            <Descriptions.Item label="Visit 摘要">
              {stats ? `${stats.visitSummaries} 条` : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Persona">
              {stats ? `${stats.personas} 条` : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="WorkingMemory">
              {stats ? `${stats.workings} 条` : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="SessionTopic">
              {stats ? `${stats.topics} 条` : '—'}
            </Descriptions.Item>
          </Descriptions>
          <Divider style={{ margin: '8px 0' }} />
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            包含 <code>sanitized-config.json</code> + <code>memory.json</code> +{' '}
            <code>logs.json</code>(最多 5000 条) + <code>README.md</code>。
            <br />
            所有内容已硬脱敏:API Key / baseURL / 对话原文 / persona 原文 / 页面 URL 均替换;
            systemPrompt / todos / topic 等「用户手工字段」原文保留方便排查,但会被 JSON 文本兜底抓 sk-/ghp_ 等模式。
          </Typography.Paragraph>
          <Space>
            <Button type="primary" onClick={handleExport} loading={exporting}>
              生成并下载 debug.zip
            </Button>
            <Button onClick={previewBundle}>脱敏样例(控制台)</Button>
            <Button onClick={refreshStats}>刷新统计</Button>
          </Space>
        </Space>
      </Card>
    </>
  );
}
