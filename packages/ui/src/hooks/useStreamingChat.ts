/**
 * useStreamingChat · 订阅 Agent 流式输出
 * ---------------------------------------------
 * 职责：
 * - 维护当前窗口的 messages（UI 消息流）
 * - 维护 streamingAssistant：正在流式的 assistant 消息（正文 + 思考过程）
 * - 提供 send(userInput, references) / abort() / clear() 方法
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

      // 初始化 streaming assistant
      setStreaming({
        text: '',
        reasoning: '',
        streaming: true,
      });

      const controller = new AbortController();
      abortRef.current = controller;

      const history: ChatMessage[] = [
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
          applyChunk(chunk, setStreaming);
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
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            content: s.text,
            ...(s.reasoning ? { reasoning: s.reasoning } : {}),
            ...(typeof s.thinkingElapsedMs === 'number'
              ? { reasoningElapsedMs: s.thinkingElapsedMs }
              : {}),
            ...(s.error ? { error: true } : {}),
          },
        ]);
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
