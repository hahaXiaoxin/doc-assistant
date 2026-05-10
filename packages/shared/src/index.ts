/**
 * @doc-assistant/shared · 入口
 * ---------------------------------------------
 * 提供跨层共享的类型、工具与错误定义。
 * 约束：本包不得依赖任何业务层 package。
 *
 * 目录分区：
 * - `types/`：跨层共享的纯类型契约（article / chat / messaging）
 * - `errors/`：错误类层级
 * - `config/`：Provider 配置 schema、默认值、storage keys
 * - `utils/`：纯函数工具（logger / storage 视图 / 脱敏 / URL 归一化 / compact 等）
 *
 * 对外消费者一律 `from '@doc-assistant/shared'`，不引入 deep import。
 */

export * from './types';
export * from './errors';
export * from './config';
export * from './utils';
