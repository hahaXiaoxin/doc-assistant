/**
 * 通用注册中心
 * ---------------------------------------------
 * 用于管理按 priority 排序的策略集合（Identity/Content Extractor 共用）。
 * PHASE2 动态识别器（基于域名的 DSL 自学习提取器）会通过 registry.register() 插入到 pipeline 中，
 * 不改任何既有代码。详见 docs/ROADMAP.md §1。
 */

export interface PriorityItem {
  readonly name: string;
  /** 数字越大越优先 */
  readonly priority: number;
}

export class Registry<T extends PriorityItem> {
  private items = new Map<string, T>();

  register(item: T): void {
    this.items.set(item.name, item);
  }

  unregister(name: string): boolean {
    return this.items.delete(name);
  }

  has(name: string): boolean {
    return this.items.has(name);
  }

  get(name: string): T | undefined {
    return this.items.get(name);
  }

  /** 按 priority 降序返回所有条目 */
  list(): T[] {
    return [...this.items.values()].sort((a, b) => b.priority - a.priority);
  }

  clear(): void {
    this.items.clear();
  }

  size(): number {
    return this.items.size;
  }
}
