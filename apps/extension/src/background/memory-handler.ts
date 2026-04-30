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
 * 注意：不消费消息（return false），让 offscreen 的 listener 继续接管并响应。
 * 如果 SW 冷启动后 offscreen 还没就绪，第一条 RPC 可能会丢失——`RemoteMemoryStore`
 * 的 15s 超时能兜住，调用方 retry 即可。
 */
export function installMemoryRpcHook(): void {
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (
      message &&
      typeof message === 'object' &&
      (message as { type?: unknown }).type === MessageType.MEMORY_RPC_REQUEST
    ) {
      // fire-and-forget：保证 offscreen 活着；不拦截消息
      void ensureOffscreenAlive().catch((err: Error) => {
        logger.warn('ensureOffscreenAlive 失败（RPC 可能超时）', err.message);
      });
    }
    return false;
  });
}
