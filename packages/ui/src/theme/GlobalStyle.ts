/**
 * 全局样式（挂在 Shadow DOM 内）
 * ---------------------------------------------
 * 为 sidebar 内的 React 树提供基础样式重置，与宿主页面样式隔离。
 */
import { createGlobalStyle } from 'styled-components';
import { tokens } from './tokens';

export const GlobalStyle = createGlobalStyle`
  * {
    box-sizing: border-box;
  }

  :host {
    all: initial;
  }

  button, input, textarea, select {
    font: inherit;
    color: inherit;
  }

  /* 滚动条：细、柔和 */
  *::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  *::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.12);
    border-radius: ${tokens.radius.pill};
  }
  *::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.24);
  }
`;
