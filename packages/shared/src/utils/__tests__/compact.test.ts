import { describe, it, expect, expectTypeOf } from 'vitest';
import { compact } from '../compact';

describe('compact', () => {
  it('默认剔除 undefined 与 null', () => {
    const out = compact({ a: 1, b: undefined, c: null, d: 'x' });
    expect(out).toEqual({ a: 1, d: 'x' });
    expect('b' in out).toBe(false);
    expect('c' in out).toBe(false);
  });

  it('keep 列表保留 null/undefined 字段', () => {
    const out = compact(
      { a: 1, b: undefined, c: null, d: 2 },
      { keep: ['b', 'c'] },
    );
    expect(out).toEqual({ a: 1, b: undefined, c: null, d: 2 });
    expect('b' in out).toBe(true);
    expect('c' in out).toBe(true);
  });

  it('removeNull: false 保留 null,仍剔除 undefined', () => {
    const out = compact({ a: 1, b: null, c: undefined }, { removeNull: false });
    expect(out).toEqual({ a: 1, b: null });
    expect('c' in out).toBe(false);
  });

  it('removeUndefined: false 保留 undefined,仍剔除 null', () => {
    const out = compact(
      { a: 1, b: null, c: undefined },
      { removeUndefined: false },
    );
    expect(out).toEqual({ a: 1, c: undefined });
    expect('b' in out).toBe(false);
    expect('c' in out).toBe(true);
  });

  it('removeNull 与 removeUndefined 同时为 false 等于不删除', () => {
    const input = { a: 1, b: null, c: undefined };
    const out = compact(input, { removeNull: false, removeUndefined: false });
    expect(out).toEqual({ a: 1, b: null, c: undefined });
  });

  it('不修改输入对象 —— 原对象引用不变,key 完整', () => {
    const input = { a: 1, b: undefined, c: null };
    const out = compact(input);
    expect(out).not.toBe(input);
    expect(Object.keys(input).sort()).toEqual(['a', 'b', 'c']);
    expect(input.a).toBe(1);
    expect(input.b).toBe(undefined);
    expect(input.c).toBe(null);
  });

  it('空对象 in 空对象 out', () => {
    const out = compact({});
    expect(out).toEqual({});
  });

  it('数组值不受影响 —— 内部 null/undefined 保留', () => {
    const out = compact({ arr: [undefined, null, 1] as Array<unknown> });
    expect(out.arr).toEqual([undefined, null, 1]);
  });

  it('数组值本身为 null 时被剔除', () => {
    const out = compact({ arr: null as null | number[] });
    expect('arr' in out).toBe(false);
  });

  it('嵌套对象不递归 —— 内层 undefined 保留', () => {
    const out = compact({ a: { b: undefined, c: 1 } });
    expect(out).toEqual({ a: { b: undefined, c: 1 } });
    expect(out.a).toBeDefined();
    expect('b' in out.a!).toBe(true);
  });

  it('保留 falsy 值 —— 0、空字符串、false 不被剔', () => {
    const out = compact({ a: 0, b: '', c: false, d: null, e: undefined });
    expect(out).toEqual({ a: 0, b: '', c: false });
  });

  it('keep 为空数组时按默认行为剔除', () => {
    const out = compact({ a: 1, b: undefined }, { keep: [] });
    expect(out).toEqual({ a: 1 });
  });

  it('类型契约:返回类型字段为可选,可直接赋值给 exactOptionalPropertyTypes 下的目标', () => {
    type Target = {
      message: string;
      user?: string;
      token?: string;
    };

    const user: string | undefined = undefined;
    const token: string | undefined = 'tk';

    const out = compact({ message: 'ok', user, token });
    // 编译期断言:结果可直接赋给 Target,无需 as
    const target: Target = out;
    expect(target.message).toBe('ok');
    expect(target.user).toBe(undefined);
    expect(target.token).toBe('tk');

    // expectTypeOf 编译期检查
    expectTypeOf(out).toMatchTypeOf<{
      message: string;
      user?: string;
      token?: string;
    }>();
    // message 始终必填,因为输入类型不含 null/undefined
    expectTypeOf(out.message).toEqualTypeOf<string>();
  });

  it('类型契约:keep 字段在返回类型中仍可能为 null/undefined', () => {
    const out = compact(
      { a: 1 as number, b: null as string | null },
      { keep: ['b'] },
    );
    // b 类型仍可能为 null
    expectTypeOf(out.b).toMatchTypeOf<string | null | undefined>();
    expect(out.b).toBe(null);
  });
});
