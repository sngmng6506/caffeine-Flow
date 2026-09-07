// 라우터 마운트 순서 계약.
//
// 같은 경로에 사장님 라우터와 손님 라우터가 겹쳐 마운트돼 있다. Express는
// 먼저 등록된 쪽이 먼저 매칭하므로, 순서가 뒤집히면 손님 라우터의 `/:id` 계열
// 패턴이 사장님 전용 경로를 가로챌 수 있다. 그러면 인증 없이 큐를 조작하는
// 길이 열린다.
//
// 지금은 두 라우터의 경로 모양이 겹치지 않아 순서를 바꿔도 동작이 같다.
// 그래서 행동 테스트만으로는 순서 변경을 잡을 수 없고 — 실제로 뒤집었을 때
// 258건이 모두 통과했다 — 조립 자체를 함께 고정한다.
//
// 계약: docs/AI_CHANGE_GUARDRAILS.md#router-mount-order-contract
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

process.env.NODE_ENV = 'test';
const { app } = await import('../app.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const MOUNT = '/api/v1/cafes/:slug/recommendations';

const appLines = appSrc.split('\n');

/** app.js에서 해당 라우터를 이 경로에 마운트한 줄 번호 (1부터, 없으면 -1). */
function mountLine(file) {
  const index = appLines.findIndex(line =>
    line.includes(`app.use('${MOUNT}'`) && line.includes(file));
  return index === -1 ? -1 : index + 1;
}

describe('추천곡 라우터 마운트 순서', () => {
  it('사장님 라우터를 손님 라우터보다 먼저 등록한다', () => {
    const owner = mountLine('routes/recommendations.owner');
    const publicRouter = mountLine("routes/recommendations'");
    expect(owner, '사장님 추천곡 라우터 마운트를 찾지 못했다').toBeGreaterThan(0);
    expect(publicRouter, '손님 추천곡 라우터 마운트를 찾지 못했다').toBeGreaterThan(0);
    expect(owner, '사장님 라우터가 public 라우터보다 뒤에 마운트됐다').toBeLessThan(publicRouter);
  });

  // 순서가 지켜야 하는 실제 결과. 지금은 경로 모양이 겹치지 않아 순서와
  // 무관하게 통과하지만, 손님 라우터에 `GET /:id`나 `PUT /:id`가 생기는 순간
  // 이 테스트가 순서 위반의 피해를 직접 잡는다.
  describe('사장님 전용 경로는 인증 없이 열리지 않는다', () => {
    const cases = [
      ['get', '/api/v1/cafes/any-slug/recommendations/owner'],
      ['post', '/api/v1/cafes/any-slug/recommendations/owner'],
      ['put', '/api/v1/cafes/any-slug/recommendations/00000000-0000-0000-0000-000000000000'],
      ['delete', '/api/v1/cafes/any-slug/recommendations/00000000-0000-0000-0000-000000000000'],
    ];

    for (const [method, url] of cases) {
      it(`${method.toUpperCase()} ${url.replace('/api/v1/cafes/any-slug/recommendations', '')}`, async () => {
        const res = await request(app)[method](url);
        // 손님 라우터가 가로챘다면 200이나 404(추천곡 없음)가 나온다.
        expect([401, 403]).toContain(res.status);
      });
    }
  });
});
