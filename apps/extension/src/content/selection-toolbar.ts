/**
 * 划词迷你工具条（content script 侧）
 * ---------------------------------------------
 * 监听 mouseup + selectionchange，在有非空选区且不在扩展 host 内时，
 * 弹出一个小工具条"引用"按钮。点击后：
 *   - 向 sidebar 派发 'doc-assistant:insert-reference' CustomEvent（携带选区文本与 URL）
 *   - 同时触发 OPEN_SIDEBAR 确保面板打开
 *
 * 视觉：简洁深色胶囊按钮，低打扰。
 */
import { INSERT_REFERENCE_EVENT } from '@doc-assistant/ui';
import { createLogger } from '@doc-assistant/shared';

const logger = createLogger('extension:selection-toolbar');

const TOOLBAR_ID = 'doc-assistant-selection-toolbar';
const DEBOUNCE_MS = 150;

let toolbar: HTMLDivElement | null = null;
let debounceTimer: number | null = null;

function ensureToolbar(): HTMLDivElement {
  if (toolbar) return toolbar;
  toolbar = document.createElement('div');
  toolbar.id = TOOLBAR_ID;
  toolbar.style.cssText = `
    all: initial;
    position: absolute;
    z-index: 2147483646;
    display: none;
    font-family: -apple-system, 'PingFang SC', 'Segoe UI', Roboto, sans-serif;
  `;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '引用到 Doc Assistant';
  btn.style.cssText = `
    all: unset;
    cursor: pointer;
    padding: 6px 12px;
    border-radius: 999px;
    background: #1f1f1f;
    color: white;
    font-size: 12px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    transition: background 120ms ease, transform 120ms ease;
  `;
  btn.addEventListener('mouseenter', () => {
    btn.style.background = '#0958D9';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = '#1f1f1f';
  });
  btn.addEventListener('mousedown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    handlePick();
  });

  toolbar.appendChild(btn);
  document.body.appendChild(toolbar);
  return toolbar;
}

function hide() {
  if (toolbar) toolbar.style.display = 'none';
}

/**
 * 获取宿主页面的选区（绕过 sidebar 的 patch）。
 * 我们在 sidebar/patch-shadow-selection.ts 里覆盖过 window.getSelection，
 * 虽然已按"anchorNode 是否在 shadow 内"做判定，但为了语义明确、未来重构不踩坑，
 * toolbar 这种"就是要页面选区"的场景直接走 document.getSelection 原生实现。
 */
function getPageSelection(): Selection | null {
  // document.getSelection 的原生实现不会被 patch 影响
  return document.getSelection();
}

function handleSelectionChange() {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    const selection = getPageSelection();
    if (!selection || selection.rangeCount === 0) return hide();
    const text = selection.toString().trim();
    if (!text) return hide();

    // 忽略发生在扩展自身 host 内的选区
    const anchorNode = selection.anchorNode;
    if (anchorNode) {
      const el = anchorNode.nodeType === Node.ELEMENT_NODE ? (anchorNode as Element) : anchorNode.parentElement;
      if (el && el.closest('#doc-assistant-root')) return hide();
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return hide();

    const bar = ensureToolbar();
    bar.style.display = 'block';
    // 放在选区上方居中；若顶部不够则放下方
    const top = rect.top + window.scrollY - 36;
    const left = rect.left + window.scrollX + rect.width / 2 - 90;
    bar.style.top = `${Math.max(8 + window.scrollY, top)}px`;
    bar.style.left = `${Math.max(8, left)}px`;
  }, DEBOUNCE_MS);
}

function handlePick() {
  const selection = getPageSelection();
  if (!selection) {
    logger.debug('handlePick: 无选区对象');
    return;
  }
  const text = selection.toString().trim();
  if (!text) {
    logger.debug('handlePick: 选区文本为空');
    return;
  }
  const payload = {
    id: `ref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    text,
    source: {
      url: location.href,
      title: document.title,
    },
  };
  window.dispatchEvent(new CustomEvent(INSERT_REFERENCE_EVENT, { detail: payload }));

  // 通知 content index 打开侧边栏
  window.dispatchEvent(new CustomEvent('doc-assistant:request-open'));

  logger.debug('引用已派发:', payload.id, text.slice(0, 30));
  hide();
  // 清除选区避免工具条反复弹
  selection.removeAllRanges();
}

export function initSelectionToolbar(): void {
  document.addEventListener('selectionchange', handleSelectionChange);
  // 页面点击空白处时也主动收起
  document.addEventListener('mousedown', (e) => {
    const target = e.target as Element | null;
    if (target?.closest(`#${TOOLBAR_ID}`)) return;
    hide();
  });
  // 滚动时隐藏（选区坐标会漂）
  window.addEventListener('scroll', () => {
    hide();
  }, { passive: true });
}
