// DB 없이 도는 테스트가 test:unit 허용목록에서 빠지지 않는지 검사.
//
// vitest.unit.config.mjs는 파일을 하나씩 적는 allowlist다. 새 테스트를 만들고
// 여기에 안 적으면 `npm test`(DB 필요)에서만 돌고 `npm run test:unit`에서는
// 조용히 빠진다 — 초록인데 실행은 안 되는 상태라 눈으로 알아채기 어렵다.
// 실제로 track-metadata-youtube와 seed-demo가 그렇게 빠져 있었다.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const config = fs.readFileSync(path.join(testsDir, '..', 'vitest.unit.config.mjs'), 'utf8');

const included = new Set(
  [...config.matchAll(/'(tests\/[^']+\.test\.mjs)'/g)].map(match => match[1]),
);
const allTests = fs.readdirSync(testsDir)
  .filter(name => name.endsWith('.test.mjs'))
  .map(name => `tests/${name}`);

// DB를 직접 쓰는 테스트는 test:unit 대상이 아니다. 파일이 스스로 knex·app·
// supertest를 부르는지로 가른다.
const NEEDS_DB = /db\/knex|supertest|\.\.\/app'|migrate/;
const needsDb = (file) => NEEDS_DB.test(fs.readFileSync(path.join(testsDir, '..', file), 'utf8'));

describe('test:unit 허용목록', () => {
  it('DB가 필요 없는 테스트는 빠짐없이 들어 있다', () => {
    const missing = allTests.filter(file => !included.has(file) && !needsDb(file));

    expect(missing, `vitest.unit.config.mjs의 include에 추가한다: ${missing.join(', ')}`).toEqual([]);
  });

  it('없어진 파일이 남아 있지 않다', () => {
    expect([...included].filter(file => !allTests.includes(file))).toEqual([]);
  });
});
