/**
 * 测试用：从 fixtures 目录加载 HTML 并注入到当前 happy-dom 的 document
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function loadFixture(name: string): string {
  const path = resolve(here, 'fixtures', name);
  return readFileSync(path, 'utf-8');
}

/**
 * 把 HTML 字符串写入 happy-dom 的 document（通过 document.open/write/close）
 * 返回实际使用的 Document 对象。
 */
export function installFixture(html: string): Document {
  document.open();
  document.write(html);
  document.close();
  return document;
}
