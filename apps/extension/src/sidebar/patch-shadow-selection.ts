/**
 * patch-shadow-selection
 * ---------------------------------------------
 * 让 Lexical（以及其它依赖 `window.getSelection()` 的代码）在 Shadow DOM 内也能正确拿到选区。
 *
 * 背景：
 * - 规范规定 Selection 被 shadow 边界截断：`document.getSelection()` 不会返回 shadow 内部节点的选区
 * - Lexical 0.19 内部 `getDOMSelection` 调用的就是 `window.getSelection()`
 *   → 它在 shadow 里拿到的选区 anchorNode 为 null 或指向 shadow host，
 *     `isSelectionWithinEditor` 判断失败，输入被悄悄丢弃
 * - Chromium 暴露了 `ShadowRoot.prototype.getSelection()` 可以取到 shadow 内的选区
 *
 * 策略：
 * - 覆盖 `window.getSelection`：如果当前焦点/活动节点落在我们注册的 shadowRoot 里，
 *   返回 `shadowRoot.getSelection()`；否则 fallback 回原实现
 * - 通过维护一个注册表，支持多次挂载 / HMR 重入
 * - 幂等：重复调用 `installShadowSelectionPatch` 只会替换一次 window.getSelection
 */
import { createLogger } from '@doc-assistant/shared';

const logger = createLogger('extension:sidebar:shadow-selection-patch');

const PATCHED_FLAG = '__docAssistantShadowSelectionPatched__';

/** 已注册的 shadowRoot 集合（一般只有一个，但保留扩展性） */
const registeredRoots = new Set<ShadowRoot>();

interface ShadowRootWithSelection extends ShadowRoot {
  getSelection?: () => Selection | null;
}

/**
 * 安装 patch（幂等）。建议在 sidebar 挂载时调用。
 */
export function installShadowSelectionPatch(shadowRoot: ShadowRoot): void {
  registeredRoots.add(shadowRoot);

  const w = window as Window & { [PATCHED_FLAG]?: boolean };
  if (w[PATCHED_FLAG]) {
    logger.debug('patch 已安装，仅注册 shadowRoot');
    return;
  }

  const nativeGetSelection = window.getSelection.bind(window);

  /**
   * 判定"当前应该返回 shadow 里的选区"的**唯一**可靠信号：
   *   shadowRoot.getSelection() 存在、且 anchorNode 真实落在该 shadow 子树里。
   *
   * 不用 shadowRoot.activeElement 作判定依据——activeElement 非空只代表"焦点最近一次在这里"，
   * 不代表"当前的选区也在这里"。用户在页面上划词后 activeElement 可能仍指向 sidebar 里的
   * contenteditable，此时返回 shadow 选区会吞掉用户在页面上的真实选区（划词引用因此失败）。
   */
  const patched: typeof window.getSelection = () => {
    for (const root of registeredRoots) {
      const sr = root as ShadowRootWithSelection;
      if (typeof sr.getSelection !== 'function') continue;

      const shadowSel = sr.getSelection();
      if (
        shadowSel &&
        shadowSel.anchorNode &&
        root.contains(shadowSel.anchorNode)
      ) {
        return shadowSel;
      }
    }
    return nativeGetSelection();
  };

  window.getSelection = patched;
  w[PATCHED_FLAG] = true;
  logger.info('window.getSelection 已打补丁以支持 Shadow DOM');
}

/**
 * 解除注册（一般不需要，保留给 HMR / 测试）。
 * 注：不会卸载 window.getSelection 的替换——多次切换 patch 函数本身反而容易出错。
 */
export function unregisterShadowSelectionRoot(shadowRoot: ShadowRoot): void {
  registeredRoots.delete(shadowRoot);
}
