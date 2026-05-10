/**
 * 单测:sanitize-export(v0.6.0)
 * ---------------------------------------------
 * 覆盖矩阵(对应用户拍板的"只脱敏硬敏感"决策):
 * 硬脱敏(必须被替换):
 *   1. API Key → [REDACTED:api_key] / 整字段替换
 *   2. baseURL → 只保留 host,path/query 抹掉
 *   3. 对话原文 episodes_msg.content → [REDACTED:text,len=N]
 *   4. visit_summary.content → [REDACTED:summary,len=N]
 *   5. persona.content → [REDACTED:persona,subject=...,len=N]
 *   6. 页面 URL / canonicalUrl → 只保留 host
 *
 * 保留(用户明确要求):
 *   7. ChatSettings.systemPrompt 原文
 *   8. PageVisitRecord.title 原文
 *   9. WorkingMemoryRecord.activeGoal / todos[].content 原文
 *   10. SessionTopicRecord.currentTopic / tags 原文
 *
 * 兜底(最后一道闸):
 *   11. 即便 sk-xxx 被塞进 systemPrompt(用户决策要求保留字段),
 *       最终 JSON string 会被 redactSensitiveText 跑一遍 → sk-... 被替换
 */
import { describe, it, expect } from 'vitest';
import {
  redactUrlKeepHost,
  sanitizeExportBundle,
  sanitizeExportJson,
  sanitizeMemoryRecord,
  sanitizePageVisitRecord,
  sanitizePersonaRecord,
  sanitizeProviderConfig,
  sanitizeSessionTopicRecord,
  sanitizeWorkingMemoryRecord,
  type ExportableBundle,
} from '../sanitize-export';

describe('sanitize-export · Provider 配置', () => {
  it('API Key 被替换为 [REDACTED:api_key]', () => {
    const r = sanitizeProviderConfig({
      kind: 'qwen',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      apiKey: 'sk-abcdef1234567890abcdef1234567890',
    });
    expect(r?.apiKey).toBe('[REDACTED:api_key]');
  });

  it('baseURL 只保留 host,path 抹掉', () => {
    const r = sanitizeProviderConfig({
      kind: 'qwen',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1?token=leak',
      model: 'qwen-plus',
      apiKey: 'sk-xxxx',
    });
    expect(r?.baseURL).toBe('https://dashscope.aliyuncs.com/***');
    expect(r?.baseURL).not.toContain('compatible-mode');
    expect(r?.baseURL).not.toContain('token=leak');
  });

  it('useMain 引用只保留 useMain 字段', () => {
    const r = sanitizeProviderConfig({ useMain: true });
    expect(r).toEqual({ useMain: true });
  });

  it('空 apiKey 保持空字符串(不展示占位符)', () => {
    const r = sanitizeProviderConfig({
      kind: 'qwen',
      baseURL: 'https://a.b/x',
      model: 'm',
      apiKey: '',
    });
    expect(r?.apiKey).toBe('');
  });
});

describe('sanitize-export · URL 脱敏', () => {
  it('合法 URL 只保留 host', () => {
    expect(redactUrlKeepHost('https://example.com/foo/bar?q=1#hash')).toBe(
      'https://example.com/***',
    );
  });
  it('非法 URL 返回 [REDACTED:url]', () => {
    expect(redactUrlKeepHost('not-a-url')).toBe('[REDACTED:url]');
  });
  it('空值返回空字符串', () => {
    expect(redactUrlKeepHost(undefined)).toBe('');
    expect(redactUrlKeepHost('')).toBe('');
  });
});

describe('sanitize-export · MemoryRecord', () => {
  it('message content → [REDACTED:text,len=N]', () => {
    const r = sanitizeMemoryRecord({
      id: 'm1',
      type: 'message',
      content: '这是用户说的秘密消息',
      timestamp: 1,
      url: 'https://x.com/p/abc',
      canonicalUrl: 'https://x.com/p/abc',
      role: 'user',
      visitId: 'v1',
      orderInVisit: 3,
    });
    expect(r.content).toMatch(/^\[REDACTED:text,len=\d+\]$/);
    expect(r.content).not.toContain('秘密');
    expect(r.url).toBe('https://x.com/***');
    expect(r.canonicalUrl).toBe('https://x.com/***');
    expect(r.role).toBe('user');
    expect(r.visitId).toBe('v1');
    expect(r.orderInVisit).toBe(3);
  });

  it('visit_summary content → [REDACTED:summary,len=N]', () => {
    const r = sanitizeMemoryRecord({
      id: 'vs1',
      type: 'visit_summary',
      content: '用户在阅读 React 文档关于 hooks 的章节',
      timestamp: 2,
    });
    expect(r.content).toMatch(/^\[REDACTED:summary,len=\d+\]$/);
  });

  it('persona content → [REDACTED:persona,len=N]', () => {
    const r = sanitizeMemoryRecord({
      id: 'p1',
      type: 'persona',
      content: '用户是前端工程师',
      timestamp: 3,
    });
    expect(r.content).toMatch(/^\[REDACTED:persona,len=\d+\]$/);
  });

  it('meta.embedding 被剥离', () => {
    const r = sanitizeMemoryRecord({
      id: 'x',
      type: 'message',
      content: 'hello',
      timestamp: 0,
      meta: { embedding: 'xxx-leaked', other: 'keep' },
    });
    expect(r.meta?.embedding).toBeUndefined();
    expect(r.meta?.other).toBe('keep');
  });
});

describe('sanitize-export · Persona', () => {
  it('persona content → 带 subject 的占位符', () => {
    const r = sanitizePersonaRecord({
      id: 'p1',
      subject: 'user',
      content: '用户是后端工程师',
      status: 'confirmed',
      confidence: 0.9,
      hitCount: 3,
      reviewedByUser: true,
      createdAt: 1,
      updatedAt: 2,
      tags: ['backend'],
    });
    expect(r.content).toMatch(/^\[REDACTED:persona,subject=user,len=\d+\]$/);
    expect(r.subject).toBe('user');
    expect(r.status).toBe('confirmed');
    expect(r.tags).toEqual(['backend']);
  });
});

describe('sanitize-export · WorkingMemory(保留 activeGoal / todos.content)', () => {
  it('activeGoal / todos[].content 原文保留', () => {
    const r = sanitizeWorkingMemoryRecord({
      canonicalUrl: 'https://example.com/path/123?q=1',
      activeGoal: '读完 React hooks 章节',
      todos: [
        {
          id: 't1',
          content: '做笔记',
          status: 'pending',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      createdAt: 1,
      updatedAt: 2,
      lastAccessedAt: 3,
    });
    expect(r.activeGoal).toBe('读完 React hooks 章节');
    expect(r.todos[0]!.content).toBe('做笔记');
    expect(r.canonicalUrl).toBe('https://example.com/***');
  });
});

describe('sanitize-export · SessionTopic(保留 topic / tags)', () => {
  it('currentTopic / tags 原文保留', () => {
    const r = sanitizeSessionTopicRecord({
      visitId: 'v1',
      canonicalUrl: 'https://x.com/a?b=c',
      currentTopic: '讨论 React hooks 的性能',
      tags: ['react', 'hooks'],
      updatedAt: 1,
      history: [{ at: 1, topic: '初始', triggeredBy: 'auto' }],
    });
    expect(r.currentTopic).toBe('讨论 React hooks 的性能');
    expect(r.tags).toEqual(['react', 'hooks']);
    expect(r.canonicalUrl).toBe('https://x.com/***');
    expect(r.history?.[0]?.topic).toBe('初始');
  });
});

describe('sanitize-export · PageVisit(URL 脱敏 + title 保留)', () => {
  it('URL 脱敏,title 保留', () => {
    const r = sanitizePageVisitRecord({
      visitId: 'v1',
      startedAt: 1,
      url: 'https://secret.example.com/docs/v2?k=v',
      canonicalUrl: 'https://secret.example.com/docs/v2',
      domain: 'secret.example.com',
      title: 'React Hooks 指南',
    });
    expect(r.url).toBe('https://secret.example.com/***');
    expect(r.canonicalUrl).toBe('https://secret.example.com/***');
    expect(r.title).toBe('React Hooks 指南');
    expect(r.domain).toBe('secret.example.com');
  });
});

describe('sanitize-export · 顶层 bundle + JSON 兜底', () => {
  it('ChatSettings.systemPrompt 原文保留(排查方便)', () => {
    const r = sanitizeExportBundle({
      exportedAt: 0,
      chatSettings: { systemPrompt: '你是一个阅读助手,请用中文回答', maxTurns: 5 },
    });
    expect(r.chatSettings?.systemPrompt).toBe('你是一个阅读助手,请用中文回答');
  });

  it('即便 sk-xxx 被用户塞进 systemPrompt,最终 JSON 文本兜底也会抓住', () => {
    const bundle: ExportableBundle = {
      exportedAt: 0,
      chatSettings: {
        systemPrompt: '调试:我把 key sk-abcdef1234567890abcdef1234567890 塞这里',
      },
    };
    const json = sanitizeExportJson(bundle);
    expect(json).toContain('[REDACTED:apikey]');
    expect(json).not.toContain('sk-abcdef1234567890abcdef1234567890');
  });

  it('即便 ghp_xxx 被塞进 todos[].content,文本兜底会抓住', () => {
    const bundle: ExportableBundle = {
      exportedAt: 0,
      memory: {
        working_memories: [
          {
            canonicalUrl: 'https://a.com/x',
            todos: [
              {
                id: 't1',
                content: '下载:ghp_abcdefghij1234567890',
                status: 'pending',
                createdAt: 1,
                updatedAt: 1,
              },
            ],
            createdAt: 1,
            updatedAt: 1,
            lastAccessedAt: 1,
          },
        ],
      },
    };
    const json = sanitizeExportJson(bundle);
    expect(json).toContain('[REDACTED:apikey]');
    expect(json).not.toContain('ghp_abcdefghij1234567890');
  });

  it('兜底不会把原本结构化脱敏掉的占位符(如 [REDACTED:text]) 再次处理', () => {
    const bundle: ExportableBundle = {
      exportedAt: 0,
      memory: {
        episodes_msg: [
          {
            id: 'm1',
            type: 'message',
            content: '包含 sk-abcdef1234567890abcdef1234567890 的原始消息',
            timestamp: 1,
          },
        ],
      },
    };
    const json = sanitizeExportJson(bundle);
    // content 已经先被结构化替换成 [REDACTED:text,len=...],原始 sk 不应出现
    expect(json).not.toContain('sk-abcdef1234567890abcdef1234567890');
    expect(json).toContain('[REDACTED:text,len=');
  });

  it('bundle 完整路径:providers + memory 各层脱敏独立起效', () => {
    const bundle: ExportableBundle = {
      exportedAt: 100,
      providers: {
        main: {
          kind: 'qwen',
          baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          model: 'qwen-plus',
          apiKey: 'sk-REALKEY1234567890',
        },
        aux: { useMain: true },
      },
      memory: {
        episodes_msg: [
          { id: 'm1', type: 'message', content: 'hi', timestamp: 1, role: 'user' },
        ],
        persona: [
          {
            id: 'p1',
            subject: 'agent',
            content: '你叫小瑾',
            status: 'confirmed',
            confidence: 1,
            hitCount: 1,
            reviewedByUser: true,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    };
    const out = sanitizeExportBundle(bundle);
    expect(out.providers?.main?.apiKey).toBe('[REDACTED:api_key]');
    expect(out.providers?.main?.baseURL).toBe('https://dashscope.aliyuncs.com/***');
    expect(out.providers?.aux).toEqual({ useMain: true });
    expect(out.memory?.episodes_msg?.[0]?.content).toMatch(/REDACTED:text/);
    expect(out.memory?.persona?.[0]?.content).toMatch(/REDACTED:persona,subject=agent/);
  });
});
