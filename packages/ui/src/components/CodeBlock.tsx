/**
 * CodeBlock · fenced code block 语法高亮组件
 * ---------------------------------------------
 * v1.1 PR-4 C2 · shiki 浅色主题 + 懒加载 + 横向滚动。
 *
 * 设计要点:
 * - **单例 Highlighter**:整个 UI 共享一个 `createHighlighter` 产物,由
 *   `getHighlighter()` 懒构建。首次调用时预加载高频语言（js/ts/tsx/jsx/json/bash
 *   /md/python/html/css）到 github-light,覆盖 80% 场景。
 * - **其他语言懒加载**:请求未预载但在 shiki bundledLanguages 里的语言时,用
 *   `highlighter.loadLanguage(lang)` 异步拉对应 grammar。在加载完成前,先以
 *   "无高亮纯文本 <pre>" 渲染,加载完成后 setState 再切到高亮 HTML。
 * - **未知语言 / 空语言**:退化为纯文本 <pre>,不报错,不发网络请求。
 * - **引擎选型**:用 `createJavaScriptRegexEngine()` 而不是 oniguruma wasm。
 *   原因是本项目在 Chrome 扩展 shadow DOM 里渲染,wasm 需要走 web_accessible_resources
 *   + fetch,路径映射容易踩坑;JS 引擎精度略逊于 oniguruma,但对常见语言足够,而且
 *   打包体积更小(省掉 onig.wasm ~250KB)。
 * - **输出**:`codeToHtml` 返回的 HTML 已自带 <pre class="shiki"><code>...tokens...</code></pre>
 *   结构与行内 <span style="color:#xxx">,我们用 dangerouslySetInnerHTML 注入。由于输入
 *   code 是字符串、不经 markdown pipeline,这里不需要再消毒 —— shiki 只会输出自己构造的
 *   span,不会把 `code` 里的 HTML 当标签执行。
 * - **样式**:外层 styled wrapper 负责 `overflow-x: auto` + `max-width: 100%` + 浅色
 *   `bgSoft` 背景 + border。`white-space: pre` (不 pre-wrap) —— 需求文档明确要求长
 *   代码横向滚动而不折行。
 */
import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import type { BundledLanguage, Highlighter } from 'shiki';
import { createHighlighter, createJavaScriptRegexEngine, bundledLanguages } from 'shiki';
import { tokens } from '../theme/tokens';

/** 浅色主题 —— 固定 github-light,不做暗色切换(需求文档 Out of Scope)。 */
const THEME = 'github-light' as const;

/**
 * 初始预加载的高频语言集合 —— 覆盖常见前后端 & 配置文件。
 * shiki 的 alias 会把 js → javascript / ts → typescript 等自动 resolve。
 */
const PRELOADED_LANGS: BundledLanguage[] = [
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'json',
  'bash',
  'markdown',
  'python',
  'html',
  'css',
];

/** 把 MD fence 里的 info string 归一成 shiki 能认的语言名(小写 / trim / 常见别名映射)。 */
function normalizeLang(raw: string | undefined): string {
  if (!raw) return '';
  const s = raw.trim().toLowerCase();
  // 常见别名 —— shiki bundledLanguagesAlias 也覆盖了大部分,这里只是兜底几个写法。
  const aliasMap: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    sh: 'bash',
    shell: 'bash',
    md: 'markdown',
    yml: 'yaml',
    'c++': 'cpp',
  };
  return aliasMap[s] ?? s;
}

/** 判断 shiki 是否"认识"这个语言(已 bundle + 可动态加载)。 */
function isSupportedLang(lang: string): lang is BundledLanguage {
  return lang in bundledLanguages;
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [THEME],
      langs: PRELOADED_LANGS,
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

/** 懒加载一个新语言(幂等 —— shiki 内部会去重)。 */
async function ensureLangLoaded(highlighter: Highlighter, lang: BundledLanguage): Promise<void> {
  const loaded = highlighter.getLoadedLanguages();
  if (loaded.includes(lang)) return;
  await highlighter.loadLanguage(lang);
}

const Pre = styled.pre`
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: ${tokens.radius.sm};
  background: ${tokens.color.bgSoft};
  color: ${tokens.color.textPrimary};
  font-family: ${tokens.font.mono};
  font-size: ${tokens.font.sizeCode};
  /**
   * 横向滚动而非换行:需求文档明确 "超宽代码不折行,不撑破气泡"。
   * max-width:100% 让外层 Bubble 88% 的宽度能完整容纳 pre;
   * overflow-x:auto 使代码在超宽时自己滚;white-space:pre 保留缩进 + 禁止折行。
   */
  max-width: 100%;
  overflow-x: auto;
  white-space: pre;
  border: 1px solid ${tokens.color.border};
  line-height: 1.55;

  /* shiki 产出里 <pre class="shiki"> 外层我们已 Pre 替代。
     这里覆盖掉 shiki 自己注入的 background/padding/margin —— 有 style 属性时是
     inline style,hack 的方式是让 child span 继承我们的字体。 */
  & code {
    background: transparent;
    padding: 0;
    border-radius: 0;
    font-family: inherit;
    font-size: inherit;
    display: block;
  }

  /* 滚动条:浅灰细条,和整体浅色系保持一致。 */
  &::-webkit-scrollbar {
    height: 8px;
  }
  &::-webkit-scrollbar-thumb {
    background: ${tokens.color.border};
    border-radius: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
`;

/**
 * shiki 输出的 HTML 里顶层 <pre class="shiki" style="background-color:#fff"> ——
 * 样式里的 background-color 会覆盖我们的 bgSoft。这里把外层 <pre>...</pre> 剥掉,
 * 只保留里面的 <code> 片段,由我们的 styled <Pre> 提供背景/边框/滚动条。
 */
function extractInnerCode(html: string): string {
  const m = /^<pre[^>]*>([\s\S]*)<\/pre>\s*$/.exec(html);
  return m?.[1] ?? html;
}

export interface CodeBlockProps {
  /** MD fence 里的 info string,可能是 "ts" / "tsx" / "shell" / "" */
  language?: string | undefined;
  /** 原始代码内容(不含首尾 ```) */
  code: string;
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const normalized = normalizeLang(language);
  const supported = normalized ? isSupportedLang(normalized) : false;

  const [html, setHtml] = useState<string | null>(null);
  // streaming 场景下,code 字面几乎每个 tick 都在变,我们每次变都重跑 codeToHtml。
  // shiki 对中等长度代码块跑一次在 <5ms 量级,可以接受。
  // cancelTokenRef 用来在组件卸载 / 新一轮 highlight 前丢弃旧结果,避免 race。
  const cancelTokenRef = useRef(0);

  useEffect(() => {
    if (!supported) {
      setHtml(null);
      return;
    }
    const token = ++cancelTokenRef.current;
    let disposed = false;
    void (async () => {
      try {
        const hl = await getHighlighter();
        await ensureLangLoaded(hl, normalized as BundledLanguage);
        if (disposed || token !== cancelTokenRef.current) return;
        const out = hl.codeToHtml(code, {
          lang: normalized as BundledLanguage,
          theme: THEME,
        });
        if (disposed || token !== cancelTokenRef.current) return;
        setHtml(extractInnerCode(out));
      } catch {
        // 加载 grammar 失败 / 运行时异常 —— 退化为无高亮,不抛 UI。
        if (!disposed && token === cancelTokenRef.current) {
          setHtml(null);
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [code, normalized, supported]);

  if (supported && html) {
    return <Pre dangerouslySetInnerHTML={{ __html: html }} />;
  }
  // 未知语言 / grammar 未加载完 / 无语言 → 纯文本 pre(浅色底)。
  return (
    <Pre>
      <code>{code}</code>
    </Pre>
  );
}
