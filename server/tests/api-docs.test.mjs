// API 문서 드리프트 검사 — 코드에 정의된 모든 API 라우트가 docs/API.md에
// 문서화돼 있는지 CI에서 강제한다. 새 라우트를 추가하고 문서를 안 고치면
// 이 테스트가 실패한다.
//
// 검사 방향은 코드 → 문서 한 방향이다. 문서에만 남은 삭제된 라우트는
// 리뷰에서 드러나므로 여기서 다루지 않는다.
// 매칭 규칙: API.md의 표 행 중 같은 METHOD 셀을 가진 행에 라우트의
// subpath 문자열이 포함돼 있으면 문서화된 것으로 본다.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = fs.readFileSync(path.resolve(root, '../docs/API.md'), 'utf8');
const mdLines = md.split('\n');

// app.js에서 라우터 마운트와 직접 라우트를 추출
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const mounts = [...appSrc.matchAll(/app\.use\('([^']+)',\s*require\('\.\/src\/routes\/([^']+)'\)\)/g)]
  .map(([, mount, file]) => ({ mount, file: `${file}.js` }));

const directRoutes = [...appSrc.matchAll(/app\.(get|post|put|delete)\('(\/api\/v1[^']*|\/health)'/g)]
  .map(([, method, p]) => ({ method: method.toUpperCase(), full: p, sub: p.replace('/api/v1', '') || '/' }));

// 각 라우트 파일에서 router.METHOD('path') 추출
function routesInFile(file) {
  const src = fs.readFileSync(path.join(root, 'src/routes', file), 'utf8');
  return [...src.matchAll(/^router\.(get|post|put|delete)\('([^']*)'/gm)]
    .map(([, method, sub]) => ({ method: method.toUpperCase(), sub }));
}

const allRoutes = [
  ...directRoutes,
  ...mounts.flatMap(({ mount, file }) =>
    routesInFile(file).map((r) => ({ ...r, full: mount + (r.sub === '/' ? '' : r.sub) }))),
];

function isDocumented({ method, sub }) {
  const needle = sub === '/' ? '`/`' : sub;
  return mdLines.some((line) => line.includes(`| ${method} |`) && line.includes(needle));
}

describe('docs/API.md ↔ 라우트 코드 동기화', () => {
  it('코드의 모든 라우트가 문서화돼 있다', () => {
    const missing = allRoutes.filter((r) => !isDocumented(r));
    expect(missing, `문서화 누락: ${missing.map((m) => `${m.method} ${m.full}`).join(', ')} — docs/API.md에 추가할 것`).toEqual([]);
  });

  it('추출기가 실제로 라우트를 찾았다 (자기 검증)', () => {
    // 추출 정규식이 깨져서 0개가 되면 위 테스트가 헛되이 통과하므로 방어
    expect(allRoutes.length).toBeGreaterThan(20);
    expect(mounts.length).toBeGreaterThanOrEqual(5);
  });
});
