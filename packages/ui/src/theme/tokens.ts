/**
 * 设计令牌（Design Tokens）
 * ---------------------------------------------
 * 对应设计规范：克制、低打扰、浅色系、轻 Glassmorphism。
 * 所有组件均通过这些令牌获取色值/间距/字号，避免硬编码。
 */

export const tokens = {
  color: {
    primary: '#1677FF',
    primaryHover: '#4096FF',
    primaryActive: '#0958D9',

    textPrimary: '#1F1F1F',
    textSecondary: '#595959',
    textTertiary: '#8C8C8C',
    textInverse: '#FFFFFF',

    bgWhite: '#FFFFFF',
    bgSoft: '#FAFAFA',
    bgGray: '#F5F5F5',
    bgUserMsg: '#E6F4FF',
    bgThinking: '#F4F1FB',

    /**
     * v1.1 PR-2 背景色阶 token 化：
     * - `bgPanel`：侧边栏展开态的玻璃面板底（略偏不透明，避免 host 页透字）。
     * - `bgFab`：折叠态小圆按钮的底（比 Panel 略轻，保留玻璃感）。
     * - `bgHoverSubtle`：IconButton / 列表项 hover 的最轻叠加层。
     * 过去这几个值散落在 CollapsiblePanel / ChatPanel 里用 rgba 硬编码。
     */
    bgPanel: 'rgba(255, 255, 255, 0.96)',
    bgFab: 'rgba(255, 255, 255, 0.92)',
    bgHoverSubtle: 'rgba(0, 0, 0, 0.04)',

    border: '#E5E7EB',
    borderStrong: '#D9D9D9',

    success: '#52C41A',
    warning: '#FAAD14',
    danger: '#FF4D4F',
  },
  font: {
    family: "'PingFang SC', -apple-system, 'Segoe UI', Roboto, sans-serif",
    mono: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
    sizeBody: '14px',
    sizeSmall: '12px',
    sizeHeading: '16px',
    sizeCode: '13px',
  },
  radius: {
    sm: '6px',
    md: '10px',
    lg: '14px',
    pill: '999px',
  },
  space: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
  },
  shadow: {
    panel: '-12px 0 32px rgba(0, 0, 0, 0.08)',
    card: '0 2px 8px rgba(0, 0, 0, 0.04)',
    focus: '0 0 0 3px rgba(22, 119, 255, 0.16)',
  },
  motion: {
    fast: '120ms ease',
    normal: '200ms ease-out',
    emphasized: '300ms cubic-bezier(0.2, 0.8, 0.2, 1)',
  },
  zIndex: {
    sidebar: 2147483647,
    commandMenu: 2147483648,
    toast: 2147483649,
  },
} as const;

export type Tokens = typeof tokens;
