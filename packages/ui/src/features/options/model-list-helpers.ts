/**
 * 模型列表 UI 辅助工具
 * ---------------------------------------------
 * 在 BasicTab 与 ProviderConfigForm 之间共用：
 * - 快照版本识别（qwen-plus-2025-07-14 / -latest）
 * - 按主干 alias 聚合，默认折叠历史快照
 *
 * 纯展示层逻辑，不下沉到 provider 包（provider 包应保持"业务无关"）。
 */

import type { QwenModelListItem } from '@doc-assistant/provider';

/**
 * 判断是否是"快照"版本
 * ---------------------------------------------
 * 启发式：id 含 YYYY-MM-DD 日期后缀 或 以 -latest 结尾。
 * 例：`qwen-plus-2025-07-14` / `qwen-plus-latest`
 */
export function isSnapshotId(id: string): boolean {
  if (/-\d{4}-\d{2}-\d{2}$/.test(id)) return true;
  if (/-latest$/.test(id)) return true;
  return false;
}

/**
 * 将一批模型按"主干 alias"聚合
 * ---------------------------------------------
 * 返回两组：
 * - `primary`：主干条目（通常是 `qwen-plus` 这种稳定 alias）+ 孤儿快照
 * - `snapshotCount`：真正被折叠隐藏的快照数量（主干存在于 primary 的快照）
 *
 * 孤儿快照（主干不在列表）会被当作 primary 展示，避免整组被吞掉。
 */
export function splitSnapshots(models: QwenModelListItem[]): {
  primary: QwenModelListItem[];
  snapshotCount: number;
} {
  const primary: QwenModelListItem[] = [];
  const snapshots: QwenModelListItem[] = [];
  for (const m of models) {
    if (isSnapshotId(m.id)) snapshots.push(m);
    else primary.push(m);
  }
  const primaryIds = new Set(primary.map((m) => m.id));
  const orphans: QwenModelListItem[] = [];
  let realSnapshotCount = 0;
  for (const s of snapshots) {
    const trunk = s.id.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-latest$/, '');
    if (primaryIds.has(trunk)) {
      realSnapshotCount++;
    } else {
      orphans.push(s);
      primaryIds.add(s.id); // 同主干多个孤儿只算一个
    }
  }
  return {
    primary: [...primary, ...orphans],
    snapshotCount: realSnapshotCount,
  };
}
