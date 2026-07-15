// 인증 경계·정지 카페 노출 회귀 테스트.
// (1) requireAuth는 사장님 세션 토큰만 통과 — pending·admin 토큰은 401
// (2) 정지된 카페의 곡은 공개 통합 TOP10에서 제외
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';

const { app } = await import('../app.js');
const db = (await import('../src/db/knex.js')).default ?? (await import('../src/db/knex.js'));
const JWT_SECRET = process.env.JWT_SECRET;

let cafe;

beforeAll(async () => {
  // 마이그레이션은 globalSetup(tests/global-setup.mjs)에서 1회만 적용된다.
  await db('cafes').where({ slug: 'authbound' }).del();
  [cafe] = await db('cafes').insert({ name: '경계카페', slug: 'authbound', owner_email: 'ab@t.com' }).returning('*');
});

afterAll(async () => {
  await db('cafes').whereIn('slug', ['authbound', 'suspended1']).del();
  await db.destroy();
});

describe('requireAuth 토큰 경계', () => {
  it('정상 사장님 토큰 → 200', async () => {
    const token = jwt.sign({ cafeId: cafe.id, slug: cafe.slug }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/v1/cafes/me').set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
  });

  it('pending 토큰(가입 임시)으로 사장님 API → 401 (500 아님)', async () => {
    const pending = jwt.sign({ pending: true, googleId: 'x', email: 'x@t.com' }, JWT_SECRET, { expiresIn: '10m' });
    const res = await request(app).get('/api/v1/cafes/me').set({ Authorization: `Bearer ${pending}` });
    expect(res.status).toBe(401);
  });

  it('admin 토큰(role만)으로 사장님 API → 401 (500 아님)', async () => {
    const admin = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/v1/cafes/me').set({ Authorization: `Bearer ${admin}` });
    expect(res.status).toBe(401);
  });

  it('cafeId만 있고 slug 없는 기형 토큰 → 401', async () => {
    const malformed = jwt.sign({ cafeId: cafe.id }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/v1/cafes/me').set({ Authorization: `Bearer ${malformed}` });
    expect(res.status).toBe(401);
  });
});

describe('정지 카페와 통합 TOP10', () => {
  it('정지된 카페의 곡은 /api/v1/top10에서 제외된다', async () => {
    await db('cafes').where({ slug: 'suspended1' }).del();
    const [sus] = await db('cafes').insert({
      name: '정지카페', slug: 'suspended1', owner_email: 's1@t.com', is_suspended: true,
    }).returning('*');
    // 정지 카페에 압도적 count의 곡을 심는다 — 필터가 없다면 1위로 떠야 함
    const rows = Array.from({ length: 5 }, (_, i) => ({
      cafe_id: sus.id, video_id: 'suspended-video', title: '정지곡',
      status: 'played', requester_ip: `10.9.9.${i}`, requested_at: new Date(),
    }));
    await db('recommendations').insert(rows);

    const res = await request(app).get('/api/v1/top10');
    expect(res.status).toBe(200);
    const ids = (res.body.items || res.body || []).map((r) => r.video_id);
    expect(ids).not.toContain('suspended-video');
  });
});
