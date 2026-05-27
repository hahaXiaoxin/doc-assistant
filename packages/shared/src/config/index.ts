/**
 * @doc-assistant/shared/config · barrel
 * ---------------------------------------------
 * Provider 配置三件套:
 * - `./schema`:类型契约 / zod / 纯辅助
 * - `./defaults`:`DEFAULT_*` 常量
 * - `./storage-keys`:STORAGE_KEYS / StorageSchema
 *
 * 对外消费者一律 `from '@doc-assistant/shared'`,不引入 deep import。
 */

export * from './schema';
export * from './defaults';
export * from './storage-keys';
