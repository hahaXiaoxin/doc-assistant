/**
 * 单测：向量余弦与 Top-K
 */
import { describe, it, expect } from 'vitest';
import { norm, cosineSim, topK } from '../db/vector';

describe('norm', () => {
  it('计算 L2 范数', () => {
    expect(norm(new Float32Array([3, 4]))).toBeCloseTo(5, 5);
  });

  it('0 向量的范数是 0', () => {
    expect(norm(new Float32Array([0, 0, 0]))).toBe(0);
  });
});

describe('cosineSim', () => {
  it('相同方向向量相似度为 1', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([2, 0, 0]);
    expect(cosineSim(a, b)).toBeCloseTo(1, 5);
  });

  it('正交向量相似度为 0', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSim(a, b)).toBeCloseTo(0, 5);
  });

  it('反向向量相似度为 -1', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSim(a, b)).toBeCloseTo(-1, 5);
  });

  it('维度不一致返回 0', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0]);
    expect(cosineSim(a, b)).toBe(0);
  });

  it('0 向量与任意向量相似度为 0', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSim(a, b)).toBe(0);
  });
});

describe('topK', () => {
  it('按相似度降序返回前 K 个', () => {
    const query = new Float32Array([1, 0, 0]);
    const candidates = [
      { id: 'a', vec: new Float32Array([1, 0, 0]) }, // 1
      { id: 'b', vec: new Float32Array([0, 1, 0]) }, // 0
      { id: 'c', vec: new Float32Array([0.9, 0.1, 0]) }, // 高
      { id: 'd', vec: new Float32Array([-1, 0, 0]) }, // -1
    ];
    const result = topK(query, candidates, (c) => c.vec, 2);
    expect(result.length).toBe(2);
    expect(result[0]?.item.id).toBe('a');
    expect(result[1]?.item.id).toBe('c');
  });

  it('候选 embedding 为空时跳过', () => {
    const query = new Float32Array([1, 0, 0]);
    const candidates = [
      { id: 'a', vec: new Float32Array([1, 0, 0]) },
      { id: 'b', vec: undefined },
    ];
    const result = topK(query, candidates, (c) => c.vec, 10);
    expect(result.length).toBe(1);
    expect(result[0]?.item.id).toBe('a');
  });

  it('minScore 过滤低于阈值的结果', () => {
    const query = new Float32Array([1, 0, 0]);
    const candidates = [
      { id: 'high', vec: new Float32Array([1, 0, 0]) },
      { id: 'low', vec: new Float32Array([0, 1, 0]) }, // 相似度 0
    ];
    const result = topK(query, candidates, (c) => c.vec, 10, 0.5);
    expect(result.length).toBe(1);
    expect(result[0]?.item.id).toBe('high');
  });

  it('空候选集返回 []', () => {
    expect(topK(new Float32Array([1]), [], () => undefined, 10)).toEqual([]);
  });
});
