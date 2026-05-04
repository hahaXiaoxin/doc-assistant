/**
 * 内联 SVG 图标集
 * ---------------------------------------------
 * v1.1 PR-3 C2 · 把 Header 里 ⟳ ⚙ ✕ / 折叠态 ⌘ 等字符图标换成真 SVG。
 *
 * 设计约束：
 * - 16×16 viewBox,stroke-width 1.75,stroke="currentColor",fill="none"
 * - 所有图标默认 16px;尺寸通过 `size` prop 覆盖
 * - 不引入 lucide-react 等第三方依赖,保持 ui 包体积 & CSP 纯净
 *
 * 命名对齐 lucide 语义,便于日后无痛替换:
 * - MessageSquarePlus  → 开启新对话(清空上下文)
 * - Settings           → 打开配置
 * - PanelRightClose    → 折叠侧栏
 * - MessageCircle      → 折叠态打开入口(CollapsedFab)
 */
import type { SVGProps } from 'react';

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function baseProps(size: number): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
  };
}

/** 开启新对话(聊天气泡 + 加号);语义比 RotateCcw 更贴"新一轮对话" */
export function IconMessageSquarePlus({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...baseProps(size)} {...rest}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h9" />
      <path d="M15 6h6" />
      <path d="M18 3v6" />
    </svg>
  );
}

/** 齿轮配置 */
export function IconSettings({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...baseProps(size)} {...rest}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** 折叠侧栏(面板 + 向右合起的箭头) */
export function IconPanelRightClose({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...baseProps(size)} {...rest}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
      <path d="m8 9 3 3-3 3" />
    </svg>
  );
}

/** 折叠态入口气泡(MessageCircle) */
export function IconMessageCircle({ size = 16, ...rest }: IconProps): JSX.Element {
  return (
    <svg {...baseProps(size)} {...rest}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}
