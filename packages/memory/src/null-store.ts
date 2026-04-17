/**
 * NullMemoryStore · 空实现
 * ---------------------------------------------
 * MVP 默认注入此实现：所有方法是 no-op。
 * Agent 层写 remember()、读 recall() 都能正常运行，只是不返回任何数据。
 *
 * PHASE2: 替换为 DexieMemoryStore 即可接入完整能力，Agent 代码零改动。
 */
import type { MemoryRecord, MemoryStore, RecallQuery } from './interface';

export class NullMemoryStore implements MemoryStore {
  async remember(_record: MemoryRecord): Promise<void> {
    // no-op
  }

  async recall(_query: RecallQuery): Promise<MemoryRecord[]> {
    return [];
  }
}
