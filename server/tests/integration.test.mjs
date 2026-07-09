// 통합 테스트 — 실제 Postgres에 마이그레이션을 적용하고 Express 앱을
// supertest로 검증한다. 실행 전제:
//   DATABASE_URL: 비어있는 테스트 DB (예: postgres://postgres:test@localhost/caffeine_test)
//   JWT_SECRET:   임의 값
//   NODE_ENV:     test (rate limiter 스킵)
// CI에서는 postgres:16 서비스 컨테이너로 자동 구성됨 (ci.yml).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';

const { app } = await import('../app.js');
const db = (await import('../src/db/knex.js')).default ?? (await import('../src/db/knex.js'));

const JWT_SECRET = process.env.JWT_SECRET;

let cafe;
let ownerToken;

function guestHeaders(visitorId = 'test-visitor-1') {
  return { 'x-visitor-id': visitorId };
}

async function postRec(videoId, visitorId, overrides = {}) {
  return request(app)
    .post(`/api/v1/cafes/${cafe.slug}/recommendations`)
    .set(guestHeaders(visitorId))
    .send({ videoId, title: `곡 ${videoId}`, platform: 'youtube', ...overrides });
}

beforeAll(async () => {
  // knexfile은 CLI(cwd=src/db) 기준이라 프로그래매틱 호출엔 경로 명시 필요
  const migrationsDir = new URL('../src/db/migrations', import.meta.url).pathname;
  await db.migrate.latest({ directory: migrationsDir });
  // 잔여 데이터 제거 (재실행 대비)
  await db('recommendations').del();
  await db('cafes').del();
  [cafe] = await db('cafes')
    .insert({ name: '테스트 카페', slug: 'testcafe1', owner_email: 't@t.com' })
    .returning('*');
  ownerToken = jwt.sign({ cafeId: cafe.id, slug: cafe.slug }, JWT_SECRET, { expiresIn: '1h' });
});

afterAll(async () => {
  await db.destroy();
});

describe('추천곡 신청', () => {
  it('정상 신청 → 201', async () => {
    const res = await postRec('vid_ok');
    expect(res.status).toBe(201);
    expect(res.body.video_id).toBe('vid_ok');
    expect(res.body.status).toBe('pending');
  });

  it('같은 곡 중복 신청 → 409 (사전 체크 + unique index)', async () => {
    const res = await postRec('vid_ok', 'other-visitor');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('이미 대기 중');
  });

  it('videoId 누락 → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/cafes/${cafe.slug}/recommendations`)
      .set(guestHeaders())
      .send({ title: '제목만' });
    expect(res.status).toBe(400);
  });

  it('대기열 30곡 초과 → 429', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      cafe_id: cafe.id, video_id: `bulk_${i}`, title: `벌크 ${i}`, status: 'pending',
    }));
    await db('recommendations').insert(rows);
    const res = await postRec('vid_overflow');
    expect(res.status).toBe(429);
    await db('recommendations').whereIn('video_id', rows.map(r => r.video_id)).del();
  });

  it('손님 큐 조회는 active 상태만 노출한다', async () => {
    await db('recommendations').insert([
      { cafe_id: cafe.id, video_id: 'visible_pending', title: '보이는 곡', status: 'pending' },
      { cafe_id: cafe.id, video_id: 'hidden_played', title: '재생 완료 곡', status: 'played' },
      { cafe_id: cafe.id, video_id: 'hidden_skipped', title: '스킵 곡', status: 'skipped' },
      { cafe_id: cafe.id, video_id: 'hidden_rejected', title: '거절 곡', status: 'rejected' },
    ]);

    const res = await request(app).get(`/api/v1/cafes/${cafe.slug}/recommendations`);
    expect(res.status).toBe(200);
    const ids = res.body.recommendations.map(r => r.video_id);
    expect(ids).toContain('visible_pending');
    expect(ids).not.toContain('hidden_played');
    expect(ids).not.toContain('hidden_skipped');
    expect(ids).not.toContain('hidden_rejected');
  });
});

describe('손님 취소 — 소유권 검증', () => {
  it('타인 신청(다른 visitor + 다른 IP) 취소 → 403', async () => {
    const [rec] = await db('recommendations').insert({
      cafe_id: cafe.id, video_id: 'cancel_victim', title: '피해자 곡',
      status: 'pending', visitor_id: 'someone-else', requester_ip: '10.99.99.99',
    }).returning('*');
    const res = await request(app)
      .delete(`/api/v1/cafes/${cafe.slug}/recommendations/${rec.id}/cancel`)
      .set(guestHeaders('attacker'));
    expect(res.status).toBe(403);
  });

  it('본인 신청(visitor_id 일치) 취소 → 200', async () => {
    const [rec] = await db('recommendations').insert({
      cafe_id: cafe.id, video_id: 'cancel_mine', title: '내 곡',
      status: 'pending', visitor_id: 'me-visitor', requester_ip: '10.99.99.99',
    }).returning('*');
    const res = await request(app)
      .delete(`/api/v1/cafes/${cafe.slug}/recommendations/${rec.id}/cancel`)
      .set(guestHeaders('me-visitor'));
    expect(res.status).toBe(200);
    expect((await db('recommendations').where({ id: rec.id }).first())).toBeUndefined();
  });
});

describe('투표', () => {
  it('중복 투표 → 409 (UNIQUE 제약)', async () => {
    const [rec] = await db('recommendations').insert({
      cafe_id: cafe.id, video_id: 'vote_target', title: '투표 곡', status: 'pending',
    }).returning('*');
    const url = `/api/v1/cafes/${cafe.slug}/recommendations/${rec.id}/vote`;
    const first = await request(app).post(url).set(guestHeaders());
    expect(first.status).toBe(200);
    const second = await request(app).post(url).set(guestHeaders());
    expect(second.status).toBe(409);
  });
});

describe('통계 — knex raw ? 바인딩 회귀 (split_part 이스케이프)', () => {
  beforeAll(async () => {
    // '?si=' 추적 파라미터가 붙은 곡과 원곡이 하나로 병합되는지까지 검증
    await db('recommendations').insert([
      { cafe_id: cafe.id, video_id: 'canon_a', title: '병합 곡', status: 'played', vote_count: 2 },
      { cafe_id: cafe.id, video_id: 'canon_a?si=xyz', title: '병합 곡', status: 'played', vote_count: 1 },
    ]);
  });

  const authed = (path) =>
    request(app).get(path).set({ Authorization: `Bearer ${ownerToken}` });

  it('GET /api/v1/top10 → 200 + 정규화 병합', async () => {
    const res = await request(app).get('/api/v1/top10');
    expect(res.status).toBe(200);
    const merged = res.body.items.find(i => i.video_id === 'canon_a');
    expect(merged.count).toBe(2);
  });

  it('GET /cafes/me/stats → 200 (topSongs 집계)', async () => {
    const res = await authed('/api/v1/cafes/me/stats');
    expect(res.status).toBe(200);
    expect(res.body.topSongs.find(s => s.video_id === 'canon_a').count).toBe(2);
  });

  it('GET /cafes/me/stats/daily·hourly·weekday·hourly-songs → 모두 200', async () => {
    for (const p of ['/daily?date=2026-07-09', '/hourly', '/weekday', '/hourly-songs?hour=0']) {
      const res = await authed(`/api/v1/cafes/me/stats${p}`);
      expect(res.status, p).toBe(200);
    }
  });
});

describe('사장님 상태 변경 — 인증·전이 검증', () => {
  let rec;
  beforeAll(async () => {
    [rec] = await db('recommendations').insert({
      cafe_id: cafe.id, video_id: 'owner_target', title: '사장님 곡', status: 'pending',
    }).returning('*');
  });

  const put = (token, status) =>
    request(app)
      .put(`/api/v1/cafes/${cafe.slug}/recommendations/${rec.id}`)
      .set(token ? { Authorization: `Bearer ${token}` } : {})
      .send({ status });

  it('토큰 없음 → 401', async () => {
    expect((await put(null, 'accepted')).status).toBe(401);
  });

  it('다른 카페 토큰 → 403', async () => {
    const wrong = jwt.sign({ cafeId: cafe.id, slug: 'othercafe' }, JWT_SECRET, { expiresIn: '1h' });
    expect((await put(wrong, 'accepted')).status).toBe(403);
  });

  it('pending → playing → played 정상 전이', async () => {
    expect((await put(ownerToken, 'playing')).status).toBe(200);
    const done = await put(ownerToken, 'played');
    expect(done.status).toBe(200);
    expect(done.body.played_at).toBeTruthy();
  });

  it('종료 상태(played) → accepted 역방향 전이 → 409', async () => {
    expect((await put(ownerToken, 'accepted')).status).toBe(409);
  });
});
