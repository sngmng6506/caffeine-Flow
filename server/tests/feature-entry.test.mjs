// 입구(index.js)가 있는 기능 모듈을 바깥에서 입구로만 부르는지 검사.
//
// 입구가 있어도 바깥 코드가 내부 파일을 직접 부르기 시작하면, 내부 함수를 고칠 때
// 다시 저장소 전체를 뒤져야 한다. 입구를 둔 이유가 사라진다. 그래서 우회를 잡는다.
// 모듈 안 파일끼리 부르는 것은 대상이 아니다. 테스트와 scripts/의 측정 도구는
// 부품을 직접 재는 것이 목적이라 server/src만 검사한다.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

// 입구를 둔 모듈. 새로 입구를 두면 여기에 추가한다.
const MODULES = ['audio-analysis', 'music-filter'];

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'migrations' ? [] : sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

describe.each(MODULES)('%s 입구', (name) => {
  const moduleDir = path.join(srcDir, 'features', name);
  const entryPaths = new Set([path.join(moduleDir, 'index'), path.join(moduleDir, 'index.js')]);

  it('모듈 밖 코드는 내부 파일을 직접 부르지 않는다', () => {
    const bypasses = [];
    for (const file of sourceFiles(srcDir)) {
      if (file.startsWith(moduleDir + path.sep)) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const [, target] of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        if (!target.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(file), target);
        if (resolved.startsWith(moduleDir + path.sep) && !entryPaths.has(resolved)) {
          bypasses.push(`${path.relative(srcDir, file)} → ${target}`);
        }
      }
    }
    expect(bypasses, `features/${name} 입구(index.js)로 바꾼다`).toEqual([]);
  });

  it('입구가 내놓는 항목 중 비어 있는 것이 없다', () => {
    // 내부 이름을 잘못 적으면 undefined가 나간다. 그 경로는 호출되는 순간에야 깨진다.
    const entry = require(`../src/features/${name}`);
    const missing = [];
    (function walk(node, prefix) {
      for (const [key, value] of Object.entries(node)) {
        if (value === undefined || value === null) missing.push(`${prefix}${key}`);
        else if (typeof value === 'object') walk(value, `${prefix}${key}.`);
      }
    })(entry, '');
    expect(missing).toEqual([]);
  });
});
