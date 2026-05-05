/**
 * MessageBubble · 单条消息气泡
 * ---------------------------------------------
 * - 用户消息右对齐，浅蓝底
 * - 助手消息左对齐，浅灰底
 * - 流式未完成时末尾显示光标
 *
 * v1.1 PR-4 C1 · 引入 react-markdown:
 * - 替换掉之前只处理 ``` 代码块的 renderBasicMarkdown(),改走 react-markdown + remark-gfm,
 *   原生支持 GFM 表格 / 任务列表 / 删除线 / 自动链接 / 引用 / 标题 / 分隔线 等。
 * - rehype-sanitize 默认白名单防止把 <script>/<iframe>/on* 等渲染出来,即便 LLM 返回
 *   恶意 HTML 也不会在 shadow DOM 里执行。
 * - 行内 <code> 继续用 Bubble 里定义的浅灰底样式;fenced code block 在 PR-4 C2 会走
 *   专用的 <CodeBlock> 组件做 shiki 高亮,这里先给一个"无高亮纯文本 <pre>"的 fallback。
 * - user 消息也走 markdown —— 代价很低(纯文本在 react-markdown 下就是 <p>),收益是
 *   粘贴一段 MD 过来也能正确展示。`white-space` 由 react-markdown 自己管,外层 Bubble
 *   不再 pre-wrap。
 */
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import styled, { keyframes } from 'styled-components';
import { tokens } from '../theme/tokens';

export interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: boolean;
}

const blink = keyframes`
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
`;

const Row = styled.div<{ $role: 'user' | 'assistant' }>`
  display: flex;
  justify-content: ${(p) => (p.$role === 'user' ? 'flex-end' : 'flex-start')};
  padding: 0 4px;
`;

const Bubble = styled.div<{ $role: 'user' | 'assistant'; $error?: boolean }>`
  max-width: 88%;
  padding: 10px 14px;
  border-radius: ${tokens.radius.lg};
  font-size: ${tokens.font.sizeBody};
  line-height: 1.7;
  word-break: break-word;
  background: ${(p) =>
    p.$error
      ? 'rgba(255, 77, 79, 0.08)'
      : p.$role === 'user'
        ? tokens.color.bgUserMsg
        : tokens.color.bgGray};
  color: ${(p) => (p.$error ? tokens.color.danger : tokens.color.textPrimary)};
  /*
   * v1.1 PR-2 C5 气泡 border 微调：
   * - 错误态保留红色描边以突出。
   * - 用户气泡把之前略偏重的 rgba(22,119,255,0.12) 降到 0.08，和 bgUserMsg 贴得更近，
   *   避免在白底面板上两道蓝线过于抢眼。
   * - 助手气泡从 transparent 改为和背景同阶的浅灰线，让两侧气泡"看起来是
   *   同一套体系"，顺便给没有阴影的 host 页做个极轻的边缘分隔。
   */
  border: 1px solid
    ${(p) =>
      p.$error
        ? 'rgba(255, 77, 79, 0.24)'
        : p.$role === 'user'
          ? 'rgba(22, 119, 255, 0.08)'
          : tokens.color.border};
  box-shadow: ${tokens.shadow.card};

  /*
   * markdown 元素的视觉节奏:首段 / 末段贴紧气泡边,段间留 8px,标题上方略紧凑。
   * 不做"压缩全部 margin 到 0"的粗暴处理,否则长答复会挤成一团。
   */
  & > :first-child { margin-top: 0; }
  & > :last-child { margin-bottom: 0; }

  p { margin: 0 0 8px; }
  h1, h2, h3, h4, h5, h6 {
    margin: 12px 0 6px;
    font-weight: 600;
    line-height: 1.35;
  }
  h1 { font-size: 1.35em; }
  h2 { font-size: 1.22em; }
  h3 { font-size: 1.1em; }
  h4, h5, h6 { font-size: 1em; }

  ul, ol { margin: 0 0 8px; padding-left: 1.4em; }
  li { margin: 2px 0; }
  li > p { margin: 0; }

  blockquote {
    margin: 8px 0;
    padding: 2px 12px;
    border-left: 3px solid ${tokens.color.border};
    color: ${tokens.color.textSecondary};
    background: rgba(0, 0, 0, 0.02);
  }

  hr {
    border: none;
    border-top: 1px solid ${tokens.color.border};
    margin: 12px 0;
  }

  a {
    color: ${tokens.color.primary};
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  img {
    max-width: 100%;
    border-radius: ${tokens.radius.sm};
  }

  table {
    border-collapse: collapse;
    margin: 8px 0;
    font-size: ${tokens.font.sizeSmall};
    display: block;
    overflow-x: auto;
    max-width: 100%;
  }
  th, td {
    padding: 4px 8px;
    border: 1px solid ${tokens.color.border};
    text-align: left;
  }
  th { background: ${tokens.color.bgSoft}; font-weight: 600; }

  /* 行内 code:浅灰圆角;代码块(<pre>)在 PR-4 C2 会被 <CodeBlock> 接管,
     此处留一个"无语言的 fenced code"纯文本 fallback。 */
  code {
    font-family: ${tokens.font.mono};
    font-size: ${tokens.font.sizeCode};
    background: rgba(0, 0, 0, 0.06);
    border-radius: 4px;
    padding: 1px 4px;
  }

  pre {
    margin: 8px 0;
    padding: 10px 12px;
    border-radius: ${tokens.radius.sm};
    background: ${tokens.color.bgSoft};
    color: ${tokens.color.textPrimary};
    font-family: ${tokens.font.mono};
    font-size: ${tokens.font.sizeCode};
    overflow-x: auto;
    max-width: 100%;
    border: 1px solid ${tokens.color.border};
  }
  pre code {
    background: transparent;
    padding: 0;
    border-radius: 0;
    font-size: inherit;
  }
`;

const Cursor = styled.span`
  display: inline-block;
  width: 2px;
  height: 1em;
  background: ${tokens.color.primary};
  margin-left: 2px;
  vertical-align: -2px;
  animation: ${blink} 1s step-end infinite;
`;

/** 外链统一加 noopener/noreferrer + 新标签打开 */
function MdLink({ children, href, ...rest }: ComponentPropsWithoutRef<'a'>): ReactNode {
  const isExternal = typeof href === 'string' && /^https?:\/\//i.test(href);
  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

const markdownComponents = {
  a: MdLink,
} as const;

export function MessageBubble({ role, content, streaming, error }: MessageBubbleProps) {
  return (
    <Row $role={role}>
      <Bubble $role={role} {...(error ? { $error: true } : {})}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
        {streaming && <Cursor />}
      </Bubble>
    </Row>
  );
}
