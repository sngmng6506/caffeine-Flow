// 자동 음향 분석 모듈을 바깥에서 입구(index.js)로만 부르는지 검사.
//
// 입구가 있어도 바깥 코드가 내부 파일을 직접 부르기 시작하면, 내부 함수를 고칠 때
// 다시 저장소 전체를 뒤져야 한다. 입구를 둔 이유가 사라진다. 그래서 우회를 잡는다.
// 모듈 안 파일끼리 부르는 것과 테스트가 내부를 직접 검사하는 것은 대상이 아니다.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const moduleDir = path.join(srcDir, 'features', 'audio-analysis');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'migrations' ? [] : sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

describe('audio-analysis 입구', () => {
  it('모듈 밖 코드는 내부 파일을 직접 부르지 않는다', () => {
    const bypasses = [];
    for (const file of sourceFiles(srcDir)) {
      if (file.startsWith(moduleDir + path.sep)) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const [, target] of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        if (!target.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(file), target);
        const insideModule = resolved.startsWith(moduleDir + path.sep);
        if (insideModule && resolved !== path.join(moduleDir, 'index') && resolved !== path.join(moduleDir, 'index.js')) {
          bypasses.push(`${path.relative(srcDir, file)} → ${target}`);
        }
      }
    }
    expect(bypasses, 'features/audio-analysis 입구(index.js)로 바꾼다').toEqual([]);
  });

  it('입구가 내놓는 항목은 모두 실제 함수다', () => {
    const entry = require('../src/features/audio-analysis');
    const notFunctions = [];
    (function walk(node, prefix) {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'function') continue;
        if (value && typeof value === 'object') walk(value, `${prefix}${key}.`);
        else notFunctions.push(`${prefix}${key}`);
      }
    })(entry, '');
    expect(notFunctions).toEqual([]);
  });
});
