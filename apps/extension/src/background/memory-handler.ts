/**
 * SW · Offscreen 生命周期管理（v0.5.0）
 * ---------------------------------------------
 * 职责（参照 docs/requirements/v0.5.0-unified-memory.md §1.2 / §1.5）：
 * - 启动 / 唤醒 / 收到 MEMORY_RPC_REQUEST 前 `ensureOffscreenAlive()`（幂等）
 * - **不做 RPC 路由中转**：MV3 下 sidebar/options 直接 `chrome.runtime.sendMessage`
 *   会同时广播给 SW 和 offscreen 两个 listener；让 offscreen 直接响应
 *   可以少一跳消息（见文档 §1.4 / §R2 的"直连优化"指引，PR-1 即采用）
 * - SW 只保证 offscreen 活着；不触碰 DexieMemoryStore / embedding / 反思逻辑
 *
 * PR-2 会补：alarm onAlarm → sendMessage REFLECTION_TICK 的转发。
 */
import { MessageType, createLogger } from '@doc-assistant/shared';

const logger = createLogger('extension:background:memory');

/** offscreen.html 在 dist 里的相对路径 */
const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen/offscreen.html';

const OFFSCREEN_JUSTIFICATION =
  'Persist and query unified memory database across all host origins; run reflection jobs that outlive any single tab.';

/** 幂等：检查 offscreen 是否存在，否则创建 */
export async function ensureOffscreenAlive(): Promise<void> {
  // Chrome 109+ 才有 chrome.offscreen；更低版本已被 manifest.minimum_chrome_version 挡掉
  if (typeof chrome.offscreen === 'undefined') {
    logger.warn('chrome.offscreen 不可用（Chrome < 109？）；跳过 offscreen 拉起');
    return;
  }

  try {
    // hasDocument 可能因 version / partition 问题缺失，做兼容
    const hasDoc =
      typeof chrome.offscreen.hasDocument === 'function'
        ? await chrome.offscreen.hasDocument()
        : false;
    if (hasDoc) return;

    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      // 文档§1.5：reason=IDB_PERSISTENCE（持久化 IDB 读写）。
      // 由于当前版本的 @types/chrome 未收录该 enum 值，这里做一次字符串 cast；
      // 运行时 Chrome 109+ 支持（见 https://developer.chrome.com/docs/extensions/reference/api/offscreen）。
      reasons: ['IDB_PERSISTENCE' as chrome.offscreen.Reason],
      justification: OFFSCREEN_JUSTIFICATION,
    });
    logger.info('offscreen document 已创建');
  } catch (err) {
    // createDocument 在"已存在"时会抛错，视为幂等成功
    const msg = (err as Error).message;
    if (msg.includes('already exists') || msg.includes('single offscreen document')) {
      logger.debug('offscreen document 已存在（createDocument 重入）');
      return;
    }
    logger.error('ensureOffscreenAlive 失败', msg);
    throw err;
  }
}

/**
 * 在 SW 的 onMessage 路由里挂一个"触发器"：
 * 收到第一条 MEMORY_RPC_REQUEST 时确保 offscreen 活着。
 *
 * **契约红线（不要改）**：
 * - listener 必须 **同步** 返回 `false`——绝不能 `return true`、也绝不能调
 *   `sendResponse(...)`。Chrome MV3 规则：一旦某个 listener 声明了"我会异步响应"
 *   或同步调用了 `sendResponse`，其他 listener 的 `sendResponse` 会被丢弃；
 *   这里我们让 offscreen 的 listener 独占响应通道。
 * - 不要 `await ensureOffscreenAlive()` 再返回——listener 必须同步决策，否则
 *   Chrome 会按"未声明异步"处理（旧版 Chrome 的兼容行为不稳定）。
 * - 冷启动时 offscreen 可能还没挂 listener，第一波 RPC 会在 chrome 侧拿到
 *   undefined response；这种情况由 `RemoteMemoryStore` 的默认 chrome transport
 *   内部做有限退避重试兜底（见 packages/memory/src/remote/remote-store.ts 的
 *   `DEFAULT_RPC_RETRY_MAX` 注释），调用方不用感知。
 */
export function installMemoryRpcHook(): void {
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (
      message &&
      typeof message === 'object' &&
      (message as { type?: unknown }).type === MessageType.MEMORY_RPC_REQUEST
    ) {
      // fire-and-forget：保证 offscreen 活着；**绝不**调 sendResponse / 返回 true
      void ensureOffscreenAlive().catch((err: Error) => {
        logger.warn('ensureOffscreenAlive 失败（RPC 可能超时）', err.message);
      });
    }
    // 不声明异步、不消费消息，让 offscreen 的 listener 独占 sendResponse 通道
    return false;
  });
}
