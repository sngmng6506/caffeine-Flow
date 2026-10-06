// 라우트·소켓이 DB를 직접 부르지 않는지 검사.
//
// 라우트는 입력 확인 → 서비스 호출 → 응답만 한다. DB와 SQL은 서비스·feature만
// 다룬다. 라우트에서 쿼리를 쓰기 시작하면 서비스에 있는 규칙을 라우트가 다시 써야
// 한다 — 신청곡 쓰기는 withCafeQueue(카페 잠금)를 건너뛰고, 이력·KST 날짜 규칙은
// 두 벌이 된다. 실제로 사장님 이력과 손님 "최근 재생"이 같은 합치기 규칙을 따로
// 들고 있었다.
//
// "읽기는 되고 신청곡 쓰기만 안 된다" 같은 규칙은 판단이 필요해 언젠가 틀린다.
// 그래서 예외 없이 "부르지 않는다"로 둔다.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const LAYERS = ['routes', 'socket'];
const FORBIDDEN = [path.join(srcDir, 'db', 'knex'), path.join(srcDir, 'db', 'sql-fragments')];

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

describe('라우트·소켓 계층', () => {
  it('DB 연결과 SQL 조각을 직접 불러오지 않는다', () => {
    const violations = [];
    for (const layer of LAYERS) {
      for (const file of sourceFiles(path.join(srcDir, layer))) {
        const source = fs.readFileSync(file, 'utf8');
        for (const [, target] of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
          if (!target.startsWith('.')) continue;
          const resolved = path.resolve(path.dirname(file), target).replace(/\.js$/, '');
          if (FORBIDDEN.includes(resolved)) violations.push(`${path.relative(srcDir, file)} → ${target}`);
        }
      }
    }
    expect(violations, '쿼리는 서비스(services/)나 feature로 옮긴다').toEqual([]);
  });
});
