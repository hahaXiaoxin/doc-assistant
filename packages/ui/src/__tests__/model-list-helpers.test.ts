/**
 * 单测：model-list-helpers
 * ---------------------------------------------
 * 覆盖：
 * - isSnapshotId：日期后缀 / -latest / 非快照
 * - splitSnapshots：主干存在 → 折叠；孤儿快照 → 作为 primary 保留
 */
import { describe, it, expect } from 'vitest';
import type { QwenModelListItem } from '@doc-assistant/provider';
import { isSnapshotId, splitSnapshots } from '../features/options/model-list-helpers';

describe('isSnapshotId', () => {
  it.each([
    ['qwen-plus-2025-07-14', true],
    ['qwen-plus-2025-01-25', true],
    ['qwen-plus-latest', true],
    ['qwen-max-latest', true],
    ['qwen-plus', false],
    ['qwen-max', false],
    ['qwen3-max', false],
    ['qwen2.5-7b-instruct', false],
    ['qwen2.5-7b-instruct-1m', false], // 不是 YYYY-MM-DD 格式
  ])('%s → %s', (id, expected) => {
    expect(isSnapshotId(id)).toBe(expected);
  });
});

function mk(id: string): QwenModelListItem {
  return { id, kind: 'chat' };
}

describe('splitSnapshots', () => {
  it('主干存在时快照被折叠', () => {
    const input = [
      mk('qwen-plus'),
      mk('qwen-plus-2025-01-25'),
      mk('qwen-plus-2025-07-14'),
      mk('qwen-plus-latest'),
      mk('qwen-max'),
      mk('qwen-max-latest'),
    ];
    const { primary, snapshotCount } = splitSnapshots(input);
    expect(primary.map((m) => m.id)).toEqual(['qwen-plus', 'qwen-max']);
    expect(snapshotCount).toBe(4); // plus 的 3 个 + max 的 1 个
  });

  it('孤儿快照（主干不在列表）作为 primary 保留，防止被吞', () => {
    const input = [
      // 没有 qwen-plus 主干，只有快照
      mk('qwen-plus-2025-07-14'),
      mk('qwen-plus-latest'),
      // 这个有主干
      mk('qwen-max'),
      mk('qwen-max-latest'),
    ];
    const { primary, snapshotCount } = splitSnapshots(input);
    // qwen-plus-2025-07-14 和 qwen-plus-latest 共享主干 qwen-plus（不在列表里）
    // → 第一个被当 primary 保留；第二个认为是同一主干的孤儿，只保留一个
    expect(primary.map((m) => m.id)).toContain('qwen-max');
    // qwen-plus-* 至少保留一个
    expect(primary.some((m) => m.id.startsWith('qwen-plus-'))).toBe(true);
    // qwen-max-latest 属于真快照（主干 qwen-max 存在）
    expect(snapshotCount).toBe(1);
  });

  it('没有快照时 primary = input，snapshotCount = 0', () => {
    const input = [mk('qwen-plus'), mk('qwen-max'), mk('qwen-turbo')];
    const { primary, snapshotCount } = splitSnapshots(input);
    expect(primary.map((m) => m.id)).toEqual(['qwen-plus', 'qwen-max', 'qwen-turbo']);
    expect(snapshotCount).toBe(0);
  });

  it('全是快照且主干都不存在时：每个主干保留一个代表', () => {
    const input = [
      mk('qwen-plus-2025-01-25'),
      mk('qwen-plus-2025-07-14'),
      mk('qwen-max-2025-07-14'),
    ];
    const { primary, snapshotCount } = splitSnapshots(input);
    // qwen-plus-* 主干是 qwen-plus（不在列表），第一个当代表；第二个被当同主干孤儿折叠
    // qwen-max-* 主干是 qwen-max（不在列表），单独保留
    const ids = primary.map((m) => m.id);
    // 至少包含 qwen-max-2025-07-14
    expect(ids).toContain('qwen-max-2025-07-14');
    // qwen-plus-* 至少有一个代表
    expect(ids.filter((id) => id.startsWith('qwen-plus-')).length).toBeGreaterThanOrEqual(1);
    // 真快照数为 0（因为主干 qwen-plus / qwen-max 都不在输入里）
    expect(snapshotCount).toBe(0);
  });
});
