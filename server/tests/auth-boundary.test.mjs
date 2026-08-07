// 인증 경계·정지 카페·추천곡 tenant isolation 회귀 테스트.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
const { app } = await import('../app.js');
const db = (await import('../src/db/knex.js')).default ?? (await import('../src/db/knex.js'));
const JWT_SECRET = process.env.JWT_SECRET;
let cafe;
let otherCafe;
let ownerToken;

beforeAll(async () => {
  await db('cafes').whereIn('slug', ['authbound', 'authother']).del();
  [cafe] = await db('cafes').insert({ name: '경계카페', slug: 'authbound', owner_email: 'ab@t.com' }).returning('*');
  [otherCafe] = await db('cafes').insert({ name: '다른카페', slug: 'authother', owner_email: 'other@t.com' }).returning('*');
  ownerToken = jwt.sign({ cafeId: cafe.id, slug: cafe.slug }, JWT_SECRET, { expiresIn: '1h' });
});

afterAll(async () => {
  await db('cafes').whereIn('slug', ['authbound', 'authother', 'suspended1']).del();
  await db.destroy();
});

describe('requireAuth 토큰 경계', () => {
  it('정상 사장님 토큰 → 200', async () => {
    const res = await request(app).get('/api/v1/cafes/me').set({ Authorization: `Bearer ${ownerToken}` });
    expect(res.status).toBe(200);
  });
  it('pending 토큰으로 사장님 API → 401', async () => {
    const token = jwt.sign({ pending: true, googleId: 'x', email: 'x@t.com' }, JWT_SECRET, { expiresIn: '10m' });
    expect((await request(app).get('/api/v1/cafes/me').set({ Authorization: `Bearer ${token}` })).status).toBe(401);
  });
  it('admin 토큰으로 사장님 API → 401', async () => {
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    expect((await request(app).get('/api/v1/cafes/me').set({ Authorization: `Bearer ${token}` })).status).toBe(401);
  });
  it('slug 없는 기형 토큰 → 401', async () => {
    const token = jwt.sign({ cafeId: cafe.id }, JWT_SECRET, { expiresIn: '1h' });
    expect((await request(app).get('/api/v1/cafes/me').set({ Authorization: `Bearer ${token}` })).status).toBe(401);
  });
});

describe('추천곡 tenant isolation', () => {
  async function makeOtherRec(videoId) {
    const [rec] = await db('recommendations').insert({ cafe_id: otherCafe.id, video_id: videoId, title: videoId, status: 'pending', visitor_id: 'shared-visitor', requester_ip: '127.0.0.1' }).returning('*');
    return rec;
  }

  it('사장님 PUT/DELETE는 다른 카페 recommendation을 수정하지 않는다', async () => {
    const currentPlaying = (await db('recommendations').insert({ cafe_id: cafe.id, video_id: 'my_playing', title: '내 재생곡', status: 'playing' }).returning('*'))[0];
    const putRec = await makeOtherRec('cross_owner_put');
    const put = await request(app).put(`/api/v1/cafes/${cafe.slug}/recommendations/${putRec.id}`).set({ Authorization: `Bearer ${ownerToken}` }).send({ status: 'playing' });
    expect(put.status).toBe(404);
    expect((await db('recommendations').where({ id: putRec.id }).first()).status).toBe('pending');
    expect((await db('recommendations').where({ id: currentPlaying.id }).first()).status).toBe('playing');

    const deleteRec = await makeOtherRec('cross_owner_delete');
    const del = await request(app).delete(`/api/v1/cafes/${cafe.slug}/recommendations/${deleteRec.id}`).set({ Authorization: `Bearer ${ownerToken}` });
    expect(del.status).toBe(404);
    expect(await db('recommendations').where({ id: deleteRec.id }).first()).toBeTruthy();
  });

  it('손님 cancel은 visitor/IP가 같아도 다른 카페 곡을 취소하지 않는다', async () => {
    const rec = await makeOtherRec('cross_cancel');
    const res = await request(app).delete(`/api/v1/cafes/${cafe.slug}/recommendations/${rec.id}/cancel`).set({ 'x-visitor-id': 'shared-visitor' });
    expect(res.status).toBe(404);
    expect(await db('recommendations').where({ id: rec.id }).first()).toBeTruthy();
  });

  it('vote/unvote/comment는 다른 카페 recommendation을 404로 거절한다', async () => {
    const rec = await makeOtherRec('cross_public_mutations');
    expect((await request(app).post(`/api/v1/cafes/${cafe.slug}/recommendations/${rec.id}/vote`).set({ 'x-visitor-id': 'cross-voter' })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/cafes/${cafe.slug}/recommendations/${rec.id}/vote`).set({ 'x-visitor-id': 'cross-voter' })).status).toBe(404);
    expect((await request(app).post(`/api/v1/cafes/${cafe.slug}/recommendations/${rec.id}/comments`).send({ body: '차단' })).status).toBe(404);
    expect(Number((await db('votes').where({ recommendation_id: rec.id }).count('* as n').first()).n)).toBe(0);
    expect(Number((await db('comments').where({ recommendation_id: rec.id }).count('* as n').first()).n)).toBe(0);
  });
});

describe('정지 카페와 통합 TOP10', () => {
  it('정지된 카페의 곡은 /api/v1/top10에서 제외된다', async () => {
    await db('cafes').where({ slug: 'suspended1' }).del();
    const [sus] = await db('cafes').insert({ name: '정지카페', slug: 'suspended1', owner_email: 's1@t.com', is_suspended: true }).returning('*');
    await db('recommendations').insert(Array.from({ length: 5 }, (_, i) => ({ cafe_id: sus.id, video_id: 'suspended-video', title: '정지곡', status: 'played', requester_ip: `10.9.9.${i}`, requested_at: new Date() })));
    const res = await request(app).get('/api/v1/top10');
    expect(res.status).toBe(200);
    const ids = (res.body.items || res.body || []).map((r) => r.video_id);
    expect(ids).not.toContain('suspended-video');
  });
});
