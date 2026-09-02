// slug 재발급·재등록 기능 통합 테스트.
// 재설계한 findMovedSlug(카페 소유권 기반)의 정확성과 세션 무효화·
// 충돌·이동 안내를 검증한다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';

const { app } = await import('../app.js');
const db = (await import('../src/db/knex.js')).default ?? (await import('../src/db/knex.js'));
const JWT_SECRET = process.env.JWT_SECRET;

function tokenFor(cafe) {
  return jwt.sign({ cafeId: cafe.id, slug: cafe.slug }, JWT_SECRET, { expiresIn: '1h' });
}

async function freshCafe(slug) {
  await db('cafes').where({ slug }).del();
  const [c] = await db('cafes').insert({ name: `카페 ${slug}`, slug, owner_email: `${slug}@t.com` }).returning('*');
  return c;
}

beforeAll(async () => {
  // 마이그레이션은 globalSetup(tests/global-setup.mjs)에서 1회만 적용된다.
});

afterAll(async () => {
  await db('cafe_slug_history').del();
  await db('cafes').whereIn('slug', ['slugone', 'slugtwo', 'slugthree', 'reused01', 'reusednew', 'cyclea', 'cycleb']).del();
  await db.destroy();
});

describe('QR slug 재발급/재등록', () => {
  it('무작위 재발급 → 최초 slug 조회·복원과 새 토큰 발급', async () => {
    const cafe = await freshCafe('slugone');
    const res = await request(app)
      .put('/api/v1/cafes/me/slug')
      .set({ Authorization: `Bearer ${tokenFor(cafe)}` })
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.slug).not.toBe('slugone');
    expect(res.body.slug).toMatch(/^[a-z0-9]{4,20}$/);
    expect(res.body.token).toBeTruthy();
    // 새 토큰의 slug가 갱신됐는지
    const decoded = jwt.verify(res.body.token, JWT_SECRET);
    expect(decoded.slug).toBe(res.body.slug);

    // 옛 slug로 손님 접속 → 404 + movedTo
    const guest = await request(app).get('/api/v1/cafes/slugone/recommendations');
    expect(guest.status).toBe(404);
    expect(guest.body.movedTo).toBe(res.body.slug);

    // 새 세션에서 최초 할당 slug를 확인하고 기존 변경 API로 복원
    const me = await request(app)
      .get('/api/v1/cafes/me')
      .set({ Authorization: `Bearer ${res.body.token}` });
    expect(me.status).toBe(200);
    expect(me.body.initial_slug).toBe('slugone');

    const restored = await request(app)
      .put('/api/v1/cafes/me/slug')
      .set({ Authorization: `Bearer ${res.body.token}` })
      .send({ slug: me.body.initial_slug });
    expect(restored.status).toBe(200);
    expect(restored.body.slug).toBe('slugone');
    expect(restored.body.initial_slug).toBe('slugone');
    expect(jwt.verify(restored.body.token, JWT_SECRET).slug).toBe('slugone');
  });

  it('커스텀 slug 지정(아크릴 QR 재등록)', async () => {
    const cafe = await freshCafe('slugtwo');
    const res = await request(app)
      .put('/api/v1/cafes/me/slug')
      .set({ Authorization: `Bearer ${tokenFor(cafe)}` })
      .send({ slug: 'slugthree' });
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('slugthree');
    // 새 slug로 정상 접속
    const ok = await request(app).get('/api/v1/cafes/slugthree/recommendations');
    expect(ok.status).toBe(200);
  });

  it('이미 사용 중인 slug로 지정 → 409', async () => {
    await freshCafe('reused01'); // 이 카페가 reused01을 점유한다
    const b = await freshCafe('reusednew');
    const res = await request(app)
      .put('/api/v1/cafes/me/slug')
      .set({ Authorization: `Bearer ${tokenFor(b)}` })
      .send({ slug: 'reused01' }); // a가 쓰는 중
    expect(res.status).toBe(409);
  });

  it('잘못된 형식 slug → 400', async () => {
    const cafe = await freshCafe('slugone');
    const res = await request(app)
      .put('/api/v1/cafes/me/slug')
      .set({ Authorization: `Bearer ${tokenFor(cafe)}` })
      .send({ slug: 'AB!!' });
    expect(res.status).toBe(400);
  });

  it('slug 재사용: 버려진 slug를 다른 카페가 가져가도 이동 안내가 정확', async () => {
    // A가 reused01 → (자동) 새 slug로 이동. reused01이 비워짐
    const a = await freshCafe('reused01');
    const move1 = await request(app)
      .put('/api/v1/cafes/me/slug')
      .set({ Authorization: `Bearer ${tokenFor(a)}` })
      .send({});
    const aNewSlug = move1.body.slug;

    // B가 비워진 reused01을 커스텀으로 가져감
    const b = await freshCafe('reusednew');
    await request(app)
      .put('/api/v1/cafes/me/slug')
      .set({ Authorization: `Bearer ${tokenFor(b)}` })
      .send({ slug: 'reused01' });

    // 이제 reused01은 B가 정상 사용 중 → 손님 접속 시 200 (이동 아님)
    const guestReused = await request(app).get('/api/v1/cafes/reused01/recommendations');
    expect(guestReused.status).toBe(200);

    // A의 원래 자동 slug는 여전히 A를 가리켜야 (200)
    const guestA = await request(app).get(`/api/v1/cafes/${aNewSlug}/recommendations`);
    expect(guestA.status).toBe(200);
  });

  it('순환(A→B→A): 되돌린 slug는 이동 아님으로 정상 접속', async () => {
    const cafe = await freshCafe('cyclea');
    // cyclea → cycleb
    await request(app).put('/api/v1/cafes/me/slug')
      .set({ Authorization: `Bearer ${tokenFor(cafe)}` }).send({ slug: 'cycleb' });
    const afterFirst = await db('cafes').where({ id: cafe.id }).first();
    // cycleb → cyclea (되돌림)
    await request(app).put('/api/v1/cafes/me/slug')
      .set({ Authorization: `Bearer ${tokenFor(afterFirst)}` }).send({ slug: 'cyclea' });

    // cyclea는 다시 이 카페가 정상 사용 → 200 (findMovedSlug가 왕복 안 함)
    const guest = await request(app).get('/api/v1/cafes/cyclea/recommendations');
    expect(guest.status).toBe(200);
  });
});
