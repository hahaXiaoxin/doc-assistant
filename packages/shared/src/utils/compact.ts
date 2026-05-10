/**
 * compact · 从对象中剔除值为 null / undefined 的字段
 * ---------------------------------------------
 * 核心场景：替换形如 `...(x ? { key: x } : {})` 的三元展开,
 * 在对象字面量里按条件带上字段,契合 `exactOptionalPropertyTypes` 约束
 * (不能写 `{ key: undefined }`,必须连字段一起省掉)。
 *
 * 默认：剔除 null 和 undefined。
 * 可通过 options 调整：
 * - keep: 指定哪些 key 即便值是 null/undefined 也保留(显式 null 有语义时)
 * - removeNull: 是否剔除 null(默认 true)
 * - removeUndefined: 是否剔除 undefined(默认 true)
 *
 * 行为契约：
 * - 纯函数,不修改输入对象
 * - 浅层处理,不递归嵌套对象
 * - 数组值直接保留,不剔除内部元素
 *
 * 类型契约：
 * - 默认返回 `{ [K in keyof T]?: Exclude<T[K], null | undefined> }`,
 *   被剔除的 key 变为可选,且值类型剥离 null/undefined,可直接赋给
 *   `exactOptionalPropertyTypes` 下的可选目标
 * - 当传入 `keep` 时,被保留的 key 在结果类型中仍可能为 null/undefined
 */

/**
 * 仅把"值可能为 null/undefined"的 key 标记为可选,
 * 同时将值类型剥离 null/undefined。其余 key 保持原样必填,语义不丢。
 */
type NullishKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? K : null extends T[K] ? K : never;
}[keyof T];

type NonNullishKeys<T> = Exclude<keyof T, NullishKeys<T>>;

export type CompactResult<T extends object> =
  & { [K in NonNullishKeys<T>]: T[K] }
  & { [K in NullishKeys<T>]?: Exclude<T[K], null | undefined> };

export type CompactResultWithKeep<T extends object, K extends keyof T> =
  & { [P in Exclude<NonNullishKeys<T>, K>]: T[P] }
  & { [P in Exclude<NullishKeys<T>, K>]?: Exclude<T[P], null | undefined> }
  & { [P in K]?: T[P] };

export interface CompactOptions<T extends object> {
  keep?: ReadonlyArray<keyof T>;
  removeNull?: boolean;
  removeUndefined?: boolean;
}

export function compact<T extends object>(
  input: T,
  options?: { removeNull?: boolean; removeUndefined?: boolean },
): CompactResult<T>;
export function compact<T extends object, K extends keyof T>(
  input: T,
  options: {
    keep: ReadonlyArray<K>;
    removeNull?: boolean;
    removeUndefined?: boolean;
  },
): CompactResultWithKeep<T, K>;
export function compact<T extends object>(
  input: T,
  options: CompactOptions<T> = {},
): Partial<T> {
  const removeNull = options.removeNull ?? true;
  const removeUndefined = options.removeUndefined ?? true;
  const keep = options.keep;
  const keepSet = keep && keep.length > 0 ? new Set<PropertyKey>(keep as ReadonlyArray<PropertyKey>) : null;

  const out: Record<PropertyKey, unknown> = {};
  // 仅遍历自有可枚举键,与对象字面量展开语义一致
  for (const key of Reflect.ownKeys(input)) {
    const value = (input as Record<PropertyKey, unknown>)[key];
    if (keepSet && keepSet.has(key)) {
      out[key] = value;
      continue;
    }
    if (value === undefined && removeUndefined) continue;
    if (value === null && removeNull) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}
