/**
 * Shadow DOM Host 构建工具
 * ---------------------------------------------
 * 职责：
 * - 在宿主页面 body 中插入一个 host div
 * - 在其上 attachShadow({mode: 'open'})，创建独立样式作用域
 * - 返回 shadowRoot 与 React 挂载容器
 *
 * 关键点：
 * - host div 使用 fixed 定位于右侧，z-index 最大化以盖过大多数页面元素
 * - Shadow DOM 样式与宿主页面完全隔离，不会被页面 CSS 污染
 * - styled-components 通过 <StyleSheetManager target={shadowRoot}> 把 <style> 注入到 shadow 内
 */

export const HOST_ID = 'doc-assistant-root';

export interface ShadowHost {
  host: HTMLDivElement;
  shadowRoot: ShadowRoot;
  reactContainer: HTMLDivElement;
  /** styled-components 的 style 容器（也可直接用 shadowRoot） */
  styleContainer: HTMLDivElement;
}

/**
 * 幂等创建 Shadow DOM host。若已存在则返回已有实例。
 */
export function ensureShadowHost(): ShadowHost {
  let host = document.getElementById(HOST_ID) as HTMLDivElement | null;

  if (host?.shadowRoot) {
    const shadowRoot = host.shadowRoot;
    const reactContainer = shadowRoot.querySelector<HTMLDivElement>('#react-root');
    const styleContainer = shadowRoot.querySelector<HTMLDivElement>('#style-root');
    if (reactContainer && styleContainer) {
      return { host, shadowRoot, reactContainer, styleContainer };
    }
  }

  host = document.createElement('div');
  host.id = HOST_ID;
  // 关键：host 本身只占用极小空间，内部 UI 由 React 组件自己用 fixed 定位吸附
  //
  // pointer-events: none 让 0×0 的 host 不拦截事件；内部需要交互的容器（CollapsiblePanel
  // 里的 Panel / CollapsedFab）自行设置 pointer-events: auto 恢复。
  //
  // 不要使用 `contain: size/style/layout` · 详见 docs/TROUBLESHOOTING.md §7
  host.style.cssText = [
    'all: initial',
    'position: fixed',
    'top: 0',
    'right: 0',
    'width: 0',
    'height: 0',
    'z-index: 2147483647',
    'pointer-events: none',
  ].join(';');
  document.documentElement.appendChild(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });

  const styleContainer = document.createElement('div');
  styleContainer.id = 'style-root';
  shadowRoot.appendChild(styleContainer);

  const reactContainer = document.createElement('div');
  reactContainer.id = 'react-root';
  shadowRoot.appendChild(reactContainer);

  return { host, shadowRoot, reactContainer, styleContainer };
}
