/**
 * 向量余弦与 Top-K 召回
 * ---------------------------------------------
 * v0.2 · 纯 JS 实现（< 5000 条量级的内存扫足够用）
 *
 * 设计要点：
 * - 余弦相似度 = dot(a,b) / (|a| * |b|)
 * - 预计算 norm 缓存（WeakMap<Float32Array, number>）避免重复开方
 * - 维度不匹配直接返回 0（而不是抛错），便于混库过渡
 */

const normCache = new WeakMap<Float32Array, number>();

/** 计算向量 L2 范数 */
export function norm(vec: Float32Array): number {
  const cached = normCache.get(vec);
  if (cached !== undefined) return cached;
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i]! * vec[i]!;
  }
  const n = Math.sqrt(sum);
  normCache.set(vec, n);
  return n;
}

/** 余弦相似度，维度不一致返回 0 */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;

  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot / (na * nb);
}

export interface ScoredItem<T> {
  item: T;
  score: number;
}

/**
 * 在 candidates 中用 query 向量做 Top-K 召回。
 * @param query 查询向量
 * @param candidates 候选项数组，getVec 返回各项的 embedding（可能为 undefined，跳过）
 * @param k Top-K；默认 10
 * @param minScore 相似度下限；默认 0（表示不过滤）
 */
export function topK<T>(
  query: Float32Array,
  candidates: T[],
  getVec: (item: T) => Float32Array | undefined,
  k: number = 10,
  minScore: number = 0,
): Array<ScoredItem<T>> {
  if (!query || query.length === 0 || candidates.length === 0) return [];
  const scored: Array<ScoredItem<T>> = [];
  for (const item of candidates) {
    const v = getVec(item);
    if (!v) continue;
    const s = cosineSim(query, v);
    if (s >= minScore) {
      scored.push({ item, score: s });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
