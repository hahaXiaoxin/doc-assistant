import { describe, it, expect } from 'vitest';
import { redactSensitive, redactSensitiveText } from '../sensitive-filter';

describe('redactSensitive · email', () => {
  it('替换常规 email', () => {
    const r = redactSensitive('联系我：alice@example.com 或 bob.smith+test@mail.co.uk');
    expect(r.redacted).toBe(true);
    expect(r.counts.email).toBe(2);
    expect(r.text).toContain('[REDACTED:email]');
    expect(r.text).not.toContain('alice@example.com');
    expect(r.text).not.toContain('bob.smith+test@mail.co.uk');
  });

  it('不误伤不含 @ 的字符串', () => {
    const r = redactSensitive('这只是普通文本，没有邮箱');
    expect(r.redacted).toBe(false);
    expect(r.text).toBe('这只是普通文本，没有邮箱');
  });
});

describe('redactSensitive · phone', () => {
  it('替换中国大陆手机号', () => {
    const r = redactSensitive('我的手机是 13912345678 有事打我');
    expect(r.counts.phone).toBe(1);
    expect(r.text).toContain('[REDACTED:phone]');
  });

  it('不误伤被数字包围的 11 位片段', () => {
    const r = redactSensitive('订单号 20241234567890');
    expect(r.counts.phone).toBe(0);
  });

  it('不误伤不以 1 开头的 11 位数字', () => {
    const r = redactSensitive('编号 23912345678');
    expect(r.counts.phone).toBe(0);
  });
});

describe('redactSensitive · idcard', () => {
  it('替换 18 位身份证（数字结尾）', () => {
    const r = redactSensitive('身份证 110101199003078234');
    expect(r.counts.idcard).toBe(1);
    expect(r.text).toContain('[REDACTED:idcard]');
  });

  it('替换 18 位身份证（X 结尾）', () => {
    const r = redactSensitive('身份证 11010119900307823X');
    expect(r.counts.idcard).toBe(1);
  });

  it('17 位不匹配', () => {
    const r = redactSensitive('编码 11010119900307823');
    expect(r.counts.idcard).toBe(0);
  });
});

describe('redactSensitive · apikey', () => {
  it('替换 OpenAI sk- 前缀', () => {
    const r = redactSensitive('key 是 sk-abcdef1234567890abcdef1234567890');
    expect(r.counts.apikey).toBe(1);
    expect(r.text).toContain('[REDACTED:apikey]');
  });

  it('替换 GitHub Token ghp_', () => {
    const r = redactSensitive('token ghp_abcdefghij1234567890');
    expect(r.counts.apikey).toBe(1);
  });

  it('替换腾讯云 AKID 前缀', () => {
    const r = redactSensitive('AKIDabcdef1234567890');
    expect(r.counts.apikey).toBe(1);
  });

  it('替换 AWS AKIA 前缀（恰好 20 字符）', () => {
    const r = redactSensitive('AKIAEXAMPLE12345678A');
    expect(r.counts.apikey).toBe(1);
  });

  it('替换 JWT 三段式', () => {
    const r = redactSensitive(
      'Bearer eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3ODk.SflKxwRJSMeKKF2QT4fwp',
    );
    expect(r.counts.apikey).toBe(1);
  });

  it('sk- 前缀太短不匹配', () => {
    const r = redactSensitive('sk-abc');
    expect(r.counts.apikey).toBe(0);
  });
});

describe('redactSensitive · creditcard', () => {
  it('替换 16 位信用卡（纯数字）', () => {
    const r = redactSensitive('卡号 4111111111111111');
    expect(r.counts.creditcard).toBe(1);
  });

  it('替换带空格/连字符的 16 位信用卡', () => {
    const r = redactSensitive('卡号 4111 1111 1111 1111');
    expect(r.counts.creditcard).toBe(1);
    const r2 = redactSensitive('卡号 4111-1111-1111-1111');
    expect(r2.counts.creditcard).toBe(1);
  });
});

describe('redactSensitive · 综合', () => {
  it('同一条文本命中多类型', () => {
    const text = '邮箱 a@b.com 手机 13912345678 key sk-abcdef1234567890abcdef1234567890';
    const r = redactSensitive(text);
    expect(r.redacted).toBe(true);
    expect(r.counts.email).toBe(1);
    expect(r.counts.phone).toBe(1);
    expect(r.counts.apikey).toBe(1);
    expect(r.text).not.toContain('a@b.com');
    expect(r.text).not.toContain('13912345678');
    expect(r.text).not.toContain('sk-abcdef');
  });

  it('enabled=false 时原样返回', () => {
    const text = '邮箱 alice@example.com 手机 13912345678';
    const r = redactSensitive(text, false);
    expect(r.redacted).toBe(false);
    expect(r.text).toBe(text);
    expect(Object.values(r.counts).every((n) => n === 0)).toBe(true);
  });

  it('空串安全', () => {
    expect(redactSensitive('').redacted).toBe(false);
    expect(redactSensitive('').text).toBe('');
  });

  it('redactSensitiveText 简化 API', () => {
    const out = redactSensitiveText('mail: alice@example.com');
    expect(out).toContain('[REDACTED:email]');
  });
});
