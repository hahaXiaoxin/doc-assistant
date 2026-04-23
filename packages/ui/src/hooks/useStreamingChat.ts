/**
 * useStreamingChat · 订阅 Agent 流式输出
 * ---------------------------------------------
 * 职责：
 * - 维护当前窗口的 messages（UI 消息流）
 * - 维护 streamingAssistant：正在流式的 assistant 消息（正文 + 思考过程）
 * - 提供 send(userInput, references) / abort() / clear() 方法
 *
 * v0.2.3：
 * - 新增 `persistMessage`（可选）：每条 user/assistant 消息成功产生时调用一次，
 *   让上层（sidebar/bootstrap）把消息写入 episodes_msg。本 hook 不知道 MemoryStore 的存在，
 *   只是一个鸭子类型的 port，保持 ui 包不反向依赖 memory。
 * - 新增 `initialHistoryForLLM`（可选）：用于 ChatPanel 在 mount 时从 IDB 预热的"近期消息 + 可能的元信息"。
 *   **不会进入 UI 的 messages[]**（对用户透明），只在 send() 组装 agent 请求时前置到 history。
 *   对应用户"像真正的助手一样，不要把状态贴脸上"的诉求。
 *
 * 注意：
 * - 使用 ref 累积 text/reasoning 以避免大量 setState；定时 flush 到 state
 * - clear() 只清 UI 与 history；不触碰记忆层（MVP 也没有）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent, AgentInvokeContext } from '@doc-assistant/agent';
import type {
  ChatChunk,
  ChatMessage,
  ToolExecutionContext,
} from '@doc-assistant/shared';
import { createLogger } from '@doc-assistant/shared';

const logger = createLogger('ui:streaming-chat');

export interface StreamingAssistantMessage {
  /** 助手正文（流式累积） */
  text: string;
  /** 思考过程（流式累积） */
  reasoning: string;
  thinkingStartedAt?: number;
  thinkingElapsedMs?: number;
  streaming: boolean;
  error?: string;
}

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  reasoningElapsedMs?: number;
  error?: boolean;
}

export interface UseStreamingChatOptions {
  agent: Agent;
  /** 每次发送时动态提供的页面上下文（URL/title/selection 等） */
  buildInvokeContext: (
    userInput: string,
    references?: string,
  ) => Omit<AgentInvokeContext, 'history' | 'userInput' | 'references'>;
  /** tool 执行上下文（pageContext 等） */
  buildToolExecCtx: () => ToolExecutionContext['meta'];
  /**
   * v0.2.3 · 可选：持久化一条消息到 MemoryStore（episodes_msg）。
   * - user 消息在进入 setMessages 后立即调用；
   * - assistant 消息在 flush 时调用（只持久化成功产出的正文，不持久化 error 消息）。
   * 失败会被忽略并记录 warn 日志，不影响聊天流。
   */
  persistMessage?: (msg: { role: 'user' | 'assistant'; content: string }) => Promise<void>;
  /**
   * v0.2.3 · 可选：从 IDB 预热的"上次对话"消息。**不会进入 UI 的 messages[]**，
   * 只会在 send() 组装 agent 请求时前置到 history，让 Agent 能自然接续。
   * 变化时不会触发 UI 重渲染（用 ref 保存）。
   */
  initialHistoryForLLM?: ChatMessage[];
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useStreamingChat(opts: UseStreamingChatOptions) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [streaming, setStreaming] = useState<StreamingAssistantMessage | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setStreaming(null);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * v0.2.1：向聊天流追加一条 **非流式** assistant 消息。
   * 用于 /recall 命令回显召回结果、未来可扩展为"系统提示"卡片。
   * 不会触发 agent.run，不影响下一轮 history 的语义（它会像普通 assistant 消息
   * 一样进入下次调用的 history）。
   */
  const appendAssistantNote = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setMessages((prev) => [
      ...prev,
      {
        id: genId(),
        role: 'assistant',
        content: trimmed,
      },
    ]);
  }, []);

  const send = useCallback(
    async (userInput: string, references?: string) => {
      const trimmed = userInput.trim();
      if (!trimmed) return;

      const userMsg: UIMessage = {
        id: genId(),
        role: 'user',
        content: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);

      // v0.2.3：落库 user 消息（失败不阻塞聊天）
      if (opts.persistMessage) {
        void opts.persistMessage({ role: 'user', content: trimmed }).catch((err: Error) => {
          logger.warn('persistMessage(user) 失败', err.message);
        });
      }

      // 初始化 streaming assistant
      setStreaming({
        text: '',
        reasoning: '',
        streaming: true,
      });

      const controller = new AbortController();
      abortRef.current = controller;

      // v0.2.3：history = 预热历史（跨 visit / 过去对话）+ 本轮 UI 内累积消息
      // 注：initialHistoryForLLM 仅喂给 LLM，**不进 UI messages[]**，对用户透明
      const preloaded = opts.initialHistoryForLLM ?? [];
      const history: ChatMessage[] = [
        ...preloaded,
        ...messages.map(
          (m): ChatMessage => ({
            role: m.role,
            content: m.content,
          }),
        ),
      ];

      const invokeCtx: AgentInvokeContext = {
        userInput: trimmed,
        history,
        ...opts.buildInvokeContext(trimmed, references),
        ...(references ? { references } : {}),
      };

      const meta = opts.buildToolExecCtx();
      const execCtx: ToolExecutionContext = {
        signal: controller.signal,
        ...(meta ? { meta } : {}),
      };

      try {
        for await (const chunk of opts.agent.run(invokeCtx, execCtx)) {
          try {
            applyChunk(chunk, setStreaming);
          } catch (applyErr) {
            // 保护：UI 渲染异常不应中断 Agent 的 AsyncGenerator，
            // 否则 loop 里的 tool-calling 会被 return() 反向终止
            logger.error('applyChunk 异常:', (applyErr as Error).message);
          }
          if (chunk.type === 'finish') {
            break;
          }
        }
      } catch (err) {
        logger.error('agent 运行异常:', (err as Error).message);
        setStreaming((s) =>
          s ? { ...s, streaming: false, error: (err as Error).message } : s,
        );
      }

      // flush：把 streaming 的内容 commit 成一条 assistant UIMessage
      setStreaming((s) => {
        if (!s) return null;
        const assistantText = s.text;
        const hadError = !!s.error;
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            content: assistantText,
            ...(s.reasoning ? { reasoning: s.reasoning } : {}),
            ...(typeof s.thinkingElapsedMs === 'number'
              ? { reasoningElapsedMs: s.thinkingElapsedMs }
              : {}),
            ...(hadError ? { error: true } : {}),
          },
        ]);
        // v0.2.3：落库 assistant 消息（仅正常产出；error/空串不写）
        if (!hadError && assistantText.trim() && opts.persistMessage) {
          void opts
            .persistMessage({ role: 'assistant', content: assistantText })
            .catch((err: Error) => {
              logger.warn('persistMessage(assistant) 失败', err.message);
            });
        }
        return null;
      });
      abortRef.current = null;
    },
    [messages, opts],
  );

  // abort on unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return {
    messages,
    streaming,
    send,
    clear,
    abort,
    appendAssistantNote,
    isBusy: streaming !== null,
  };
}

function applyChunk(
  chunk: ChatChunk,
  setStreaming: React.Dispatch<React.SetStateAction<StreamingAssistantMessage | null>>,
) {
  setStreaming((s) => {
    if (!s) return s;
    switch (chunk.type) {
      case 'text-delta':
        return { ...s, text: s.text + chunk.delta };
      case 'reasoning-delta':
        return {
          ...s,
          reasoning: s.reasoning + chunk.delta,
          thinkingStartedAt: s.thinkingStartedAt ?? Date.now(),
        };
      case 'tool-call':
      case 'tool-result':
        // 可在此处扩展 tool 调用的 UI 提示；MVP 暂不展示
        return s;
      case 'finish': {
        const elapsed =
          s.thinkingStartedAt != null ? Date.now() - s.thinkingStartedAt : undefined;
        return {
          ...s,
          streaming: false,
          ...(typeof elapsed === 'number' ? { thinkingElapsedMs: elapsed } : {}),
        };
      }
      case 'error':
        return { ...s, streaming: false, error: chunk.error.message };
      default:
        return s;
    }
  });
}
