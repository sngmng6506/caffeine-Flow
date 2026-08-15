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
const { issueTrackMetadataToken } = await import('../src/services/track-metadata-token.service.js');
const { issuePendingToken } = await import('../src/utils/jwt.js');

const JWT_SECRET = process.env.JWT_SECRET;

let cafe;
let ownerToken;

function guestHeaders(visitorId = 'test-visitor-1') {
  return { 'x-visitor-id': visitorId };
}

async function postRec(videoId, visitorId, overrides = {}) {
  const track = {
    videoId,
    title: `곡 ${videoId}`,
    platform: 'youtube',
    ...(overrides.track || {}),
  };
  return request(app)
    .post(`/api/v1/cafes/${cafe.slug}/recommendations`)
    .set(guestHeaders(visitorId))
    .send({ metadataToken: issueTrackMetadataToken(track), ...overrides.body });
}

function ownerPostRec(body) {
  return request(app)
    .post(`/api/v1/cafes/${cafe.slug}/recommendations/owner`)
    .set({ Authorization: `Bearer ${ownerToken}` })
    .send(body);
}

beforeAll(async () => {
  // 마이그레이션은 globalSetup(tests/global-setup.mjs)에서 1회만 적용된다.
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
    expect(res.body.is_mine).toBe(true);
    expect(res.body).not.toHaveProperty('requester_ip');
    expect(res.body).not.toHaveProperty('visitor_id');
    expect(res.body).not.toHaveProperty('filter_model');
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

  it('서명된 서버 메타데이터를 사용하고 클라이언트의 위조 필드는 무시한다', async () => {
    const res = await postRec('signed_safe', 'signed-visitor', {
      track: { title: '서버가 확인한 제목', channelTitle: '서버 채널' },
      body: { videoId: 'spoofed-id', title: '위조 제목', platform: 'spotify' },
    });
    expect(res.status).toBe(201);
    expect(res.body.video_id).toBe('signed_safe');
    expect(res.body.title).toBe('서버가 확인한 제목');
    expect(res.body.platform).toBe('youtube');
  });

  it('변조되거나 만료된 메타데이터 토큰 → 400', async () => {
    const token = issueTrackMetadataToken({ videoId: 'tampered', title: '원본', platform: 'youtube' });
    const res = await request(app)
      .post(`/api/v1/cafes/${cafe.slug}/recommendations`)
      .set(guestHeaders('tampered-visitor'))
      .send({ metadataToken: `${token}x` });
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

  it('29곡 상태의 동시 신청도 최종 active 큐를 30곡 이하로 유지한다', async () => {
    const [raceCafe] = await db('cafes').insert({
      name: '동시성 카페', slug: 'queuerace1', owner_email: 'race@t.com',
    }).returning('*');
    await db('recommendations').insert(Array.from({ length: 29 }, (_, index) => ({
      cafe_id: raceCafe.id,
      video_id: `race_existing_${index}`,
      title: `기존 곡 ${index}`,
      status: 'pending',
    })));

    const submit = (videoId, visitorId) => request(app)
      .post(`/api/v1/cafes/${raceCafe.slug}/recommendations`)
      .set(guestHeaders(visitorId))
      .send({ metadataToken: issueTrackMetadataToken({ videoId, title: videoId, platform: 'youtube' }) });
    const responses = await Promise.all([
      submit('race_new_a', 'race-visitor-a'),
      submit('race_new_b', 'race-visitor-b'),
    ]);

    expect(responses.map(response => response.status).sort()).toEqual([201, 429]);
    const count = await db('recommendations')
      .where({ cafe_id: raceCafe.id })
      .whereIn('status', ['pending', 'accepted', 'playing'])
      .count('* as n')
      .first();
    expect(Number(count.n)).toBe(30);
    await db('cafes').where({ id: raceCafe.id }).del();
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
    for (const item of res.body.recommendations) {
      expect(item).not.toHaveProperty('requester_ip');
      expect(item).not.toHaveProperty('visitor_id');
      expect(item).not.toHaveProperty('filter_status');
      expect(item).not.toHaveProperty('filter_error_code');
    }
  });

  it('사장님 큐 조회는 AI 판단 정보만 추가하고 익명 식별자는 노출하지 않는다', async () => {
    const res = await request(app)
      .get(`/api/v1/cafes/${cafe.slug}/recommendations/owner`)
      .set({ Authorization: `Bearer ${ownerToken}` });
    expect(res.status).toBe(200);
    expect(res.body.recommendations[0]).toHaveProperty('filter_status');
    expect(res.body.recommendations[0]).not.toHaveProperty('requester_ip');
    expect(res.body.recommendations[0]).not.toHaveProperty('visitor_id');
  });

  it('7일이 지난 active 곡도 큐·한도에서 동일하게 노출한다', async () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db('recommendations').insert({
      cafe_id: cafe.id,
      video_id: 'old_but_active',
      title: '오래된 활성 곡',
      status: 'pending',
      requested_at: old,
    });
    const res = await request(app).get(`/api/v1/cafes/${cafe.slug}/recommendations`);
    expect(res.body.recommendations.map(rec => rec.video_id)).toContain('old_but_active');
  });
});

describe('사장님 직접 추가', () => {
  it('platform을 그대로 저장한다', async () => {
    const res = await ownerPostRec({
      videoId: 'spotify_owner_track',
      title: '사장님 추가 Spotify 곡',
      platform: 'spotify',
    });
    expect(res.status).toBe(201);
    expect(res.body.platform).toBe('spotify');
  });

  it('유효하지 않은 platform은 거절한다', async () => {
    const res = await ownerPostRec({
      videoId: 'invalid_owner_platform',
      title: '잘못된 플랫폼 곡',
      platform: 'melon',
    });
    expect(res.status).toBe(400);
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

  it('같은 IP여도 visitor_id가 다른 손님은 취소할 수 없다', async () => {
    const [rec] = await db('recommendations').insert({
      cafe_id: cafe.id, video_id: 'cancel_shared_wifi', title: '공용 와이파이 곡',
      status: 'pending', visitor_id: 'wifi-owner', requester_ip: '203.0.113.10',
    }).returning('*');
    const res = await request(app)
      .delete(`/api/v1/cafes/${cafe.slug}/recommendations/${rec.id}/cancel`)
      .set({ ...guestHeaders('wifi-attacker'), 'X-Forwarded-For': '203.0.113.10' });
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

  it('visitor_id가 없는 레거시·사장님 신청은 IP만으로 취소할 수 없다', async () => {
    const [rec] = await db('recommendations').insert({
      cafe_id: cafe.id, video_id: 'cancel_legacy_ip', title: '레거시 곡',
      status: 'pending', requester_ip: '203.0.113.40', visitor_id: null,
    }).returning('*');
    const res = await request(app)
      .delete(`/api/v1/cafes/${cafe.slug}/recommendations/${rec.id}/cancel`)
      .set({ ...guestHeaders('new-visitor'), 'X-Forwarded-For': '203.0.113.40' });
    expect(res.status).toBe(403);
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

  it('같은 IP의 서로 다른 visitor는 각각 투표·취소할 수 있다', async () => {
    const [rec] = await db('recommendations').insert({
      cafe_id: cafe.id, video_id: 'vote_shared_wifi', title: '공용 와이파이 투표', status: 'pending',
    }).returning('*');
    const url = `/api/v1/cafes/${cafe.slug}/recommendations/${rec.id}/vote`;
    const sharedIp = '203.0.113.20';
    expect((await request(app).post(url).set({ ...guestHeaders('wifi-voter-a'), 'X-Forwarded-For': sharedIp })).status).toBe(200);
    expect((await request(app).post(url).set({ ...guestHeaders('wifi-voter-b'), 'X-Forwarded-For': sharedIp })).status).toBe(200);
    const removed = await request(app).delete(url).set({ ...guestHeaders('wifi-voter-a'), 'X-Forwarded-For': sharedIp });
    expect(removed.status).toBe(200);
    expect(removed.body.vote_count).toBe(1);
  });
});

describe('방문자 집계 식별자', () => {
  it('같은 IP의 서로 다른 visitor는 각각 한 명으로 기록한다', async () => {
    const sharedIp = '203.0.113.30';
    for (const visitor of ['visit-wifi-a', 'visit-wifi-b', 'visit-wifi-a']) {
      await request(app)
        .get(`/api/v1/cafes/${cafe.slug}/recommendations`)
        .set({ ...guestHeaders(visitor), 'X-Forwarded-For': sharedIp });
    }
    const rows = await db('cafe_visits')
      .where({ cafe_id: cafe.id })
      .whereIn('visitor_id', ['visit-wifi-a', 'visit-wifi-b']);
    expect(rows).toHaveLength(2);
  });

  it('운영자 API는 사람 수가 아닌 익명 브라우저 수로 명시한다', async () => {
    const adminToken = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/v1/admin/cafes')
      .set({ Authorization: `Bearer ${adminToken}` });

    expect(res.status).toBe(200);
    const item = res.body.find(row => row.id === cafe.id);
    expect(item).toHaveProperty('today_unique_browsers');
    expect(item).not.toHaveProperty('today_unique_visitors');
  });
});

describe('운영자 AI 프롬프트 감사', () => {
  it('현재 설정·변경 이력·판단 당시 프롬프트를 카페 범위로 조회한다', async () => {
    const prompt = '잔잔한 재즈와 로파이만 승인합니다.';
    const firstUpdate = await request(app)
      .put('/api/v1/cafes/me/music-filter')
      .set({ Authorization: `Bearer ${ownerToken}` })
      .send({ enabled: true, prompt });
    expect(firstUpdate.status).toBe(200);

    // 같은 값을 다시 적용해도 변경 이력을 중복 생성하지 않는다.
    await request(app)
      .put('/api/v1/cafes/me/music-filter')
      .set({ Authorization: `Bearer ${ownerToken}` })
      .send({ enabled: true, prompt });

    const [decision] = await db('recommendations').insert({
      cafe_id: cafe.id,
      video_id: 'audit_rejected',
      title: '감사 대상 곡',
      channel_title: '테스트 채널',
      platform: 'youtube',
      status: 'rejected',
      filter_status: 'rejected',
      filter_reason: '매장 분위기와 맞지 않습니다.',
      filter_model: 'test-model',
      filter_prompt_snapshot: prompt,
      filter_checked_at: new Date(),
    }).returning('*');

    const adminToken = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    const response = await request(app)
      .get(`/api/v1/admin/cafes/${cafe.id}/music-filter-audit`)
      .set({ Authorization: `Bearer ${adminToken}` });

    expect(response.status).toBe(200);
    expect(response.body.current).toEqual({ enabled: true, prompt });
    expect(response.body.prompt_history.filter(item => item.prompt === prompt)).toHaveLength(1);
    expect(response.body.decisions).toContainEqual(expect.objectContaining({
      id: decision.id,
      filter_status: 'rejected',
      filter_reason: '매장 분위기와 맞지 않습니다.',
      filter_prompt_snapshot: prompt,
    }));
  });

  it('사장님 토큰으로 전체 카페 프롬프트 감사 API에 접근할 수 없다', async () => {
    const response = await request(app)
      .get(`/api/v1/admin/cafes/${cafe.id}/music-filter-audit`)
      .set({ Authorization: `Bearer ${ownerToken}` });
    expect(response.status).toBe(403);
  });
});

describe('운영자 카페 삭제', () => {
  it('삭제 확인 후 같은 Google·Naver 식별자로 다시 가입할 수 있는 DB 상태가 된다', async () => {
    const providerIds = { google_id: 'deleted-google-id', naver_id: 'deleted-naver-id' };
    const [target] = await db('cafes').insert({
      name: '삭제 대상 카페',
      slug: 'deleteaudit1',
      owner_email: 'deleted@t.com',
      ...providerIds,
    }).returning('*');
    const adminToken = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

    const response = await request(app)
      .delete(`/api/v1/admin/cafes/${target.id}`)
      .set({ Authorization: `Bearer ${adminToken}` });
    expect(response.status).toBe(200);

    const [rejoined] = await db('cafes').insert({
      name: '재가입 카페',
      slug: 'rejoinaudit1',
      owner_email: 'deleted@t.com',
      ...providerIds,
    }).returning('*');
    expect(rejoined.google_id).toBe(providerIds.google_id);
    expect(rejoined.naver_id).toBe(providerIds.naver_id);

    await db('cafes').where({ id: rejoined.id }).del();
  });
});

describe('곡 댓글 경로 검증', () => {
  it('존재하지 않는 카페 slug를 전역 댓글로 저장하지 않는다', async () => {
    const res = await request(app)
      .post('/api/v1/cafes/missing-cafe/songs/comment_guard/comments')
      .set(guestHeaders('comment-guard'))
      .send({ body: '저장되면 안 됨' });

    expect(res.status).toBe(404);
    expect(Number((await db('song_comments').where({ video_id: 'comment_guard' }).count('* as n').first()).n)).toBe(0);
  });

  it('다른 곡의 부모 댓글에는 답글을 달 수 없다', async () => {
    const [parent] = await db('song_comments').insert({
      video_id: 'reply_parent_video', cafe_id: cafe.id, body: '부모 댓글',
    }).returning('*');

    const res = await request(app)
      .post(`/api/v1/songs/other_video/comments/${parent.id}/replies`)
      .set(guestHeaders('reply-guard'))
      .send({ body: '잘못된 답글' });

    expect(res.status).toBe(400);
    expect(Number((await db('song_comments').where({ parent_id: parent.id }).count('* as n').first()).n)).toBe(0);
  });

  it('최상위 댓글을 최신순 페이지로 반환하고 해당 답글만 묶는다', async () => {
    const videoId = 'paged_comments';
    const baseTime = Date.now() - 60_000;
    const parents = await db('song_comments').insert(Array.from({ length: 23 }, (_, index) => ({
      video_id: videoId,
      cafe_id: cafe.id,
      body: `부모 ${index}`,
      created_at: new Date(baseTime + index * 1000),
    }))).returning('*');
    const newest = parents.find(parent => parent.body === '부모 22');
    await db('song_comments').insert({
      video_id: videoId,
      cafe_id: cafe.id,
      parent_id: newest.id,
      body: '최신 글 답글',
      created_at: new Date(baseTime + 30_000),
    });

    const first = await request(app).get(`/api/v1/songs/${videoId}/comments?offset=0&limit=10`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(10);
    expect(first.body.items[0].body).toBe('부모 22');
    expect(first.body.items[0].replies.map(reply => reply.body)).toEqual(['최신 글 답글']);
    expect(first.body).toMatchObject({ hasMore: true, nextOffset: 10 });

    const last = await request(app).get(`/api/v1/songs/${videoId}/comments?offset=20&limit=10`);
    expect(last.status).toBe(200);
    expect(last.body.items).toHaveLength(3);
    expect(last.body).toMatchObject({ hasMore: false, nextOffset: null });
    expect(first.body.items[0]).not.toHaveProperty('commenter_ip');
    expect(first.body.items[0]).not.toHaveProperty('visitor_id');
    expect(first.body.items[0].replies[0]).not.toHaveProperty('commenter_ip');
  });

  it('댓글 작성 응답도 익명 식별자를 노출하지 않는다', async () => {
    const res = await request(app)
      .post('/api/v1/songs/privacy_comment/comments')
      .set(guestHeaders('comment-private-visitor'))
      .send({ body: '공개 댓글' });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('commenter_ip');
    expect(res.body).not.toHaveProperty('visitor_id');
  });
});

describe('API 페이지 경계와 404 계약', () => {
  it.each([
    '/api/v1/top10?offset=-1',
    `/api/v1/cafes/${cafe?.slug || 'testcafe1'}/recommendations/top10?offset=1abc`,
    '/api/v1/songs/any/comments?limit=51',
    '/api/v1/top10?sort=count%20desc',
  ])('잘못된 페이지 파라미터를 400으로 거절한다: %s', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(400);
  });

  it('없는 API는 SPA HTML이 아니라 JSON 404를 반환한다', async () => {
    const res = await request(app).get('/api/v1/not-a-real-endpoint');
    expect(res.status).toBe(404);
    expect(res.type).toBe('application/json');
    expect(res.body.error).toBe('API endpoint not found');
  });
});

describe('손님 최근 재생 이력', () => {
  it('최근 7일 played/skipped만 새로고침 가능한 페이지로 반환한다', async () => {
    const recent = new Date();
    const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    await db('recommendations').insert([
      { cafe_id: cafe.id, video_id: 'history_recent_played', title: '최근 재생', status: 'played', played_at: recent },
      { cafe_id: cafe.id, video_id: 'history_recent_skipped', title: '최근 건너뜀', status: 'skipped', played_at: recent },
      { cafe_id: cafe.id, video_id: 'history_old_played', title: '오래된 재생', status: 'played', played_at: old, requested_at: old },
      { cafe_id: cafe.id, video_id: 'history_rejected', title: '거절', status: 'rejected', played_at: recent },
    ]);

    const res = await request(app).get(`/api/v1/cafes/${cafe.slug}/recommendations/history`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map(item => item.video_id);
    expect(ids).toContain('history_recent_played');
    expect(ids).toContain('history_recent_skipped');
    expect(ids).not.toContain('history_old_played');
    expect(ids).not.toContain('history_rejected');
    expect(res.body.items[0]).not.toHaveProperty('visitor_id');
  });
});

describe('사장님 이력·로컬 OAuth 회귀', () => {
  it('날짜별 이력은 신청일이 아니라 처리일 KST 기준으로 필터한다', async () => {
    await db('recommendations').insert({
      cafe_id: cafe.id,
      video_id: 'history_processed_date',
      title: '처리일 기준 곡',
      status: 'played',
      requested_at: new Date('2026-07-01T03:00:00.000Z'),
      played_at: new Date('2026-07-09T03:00:00.000Z'),
    });

    const onProcessedDate = await request(app)
      .get('/api/v1/cafes/me/history?date=2026-07-09')
      .set({ Authorization: `Bearer ${ownerToken}` });
    const onRequestedDate = await request(app)
      .get('/api/v1/cafes/me/history?date=2026-07-01')
      .set({ Authorization: `Bearer ${ownerToken}` });

    expect(onProcessedDate.body.items.map(item => item.video_id)).toContain('history_processed_date');
    expect(onRequestedDate.body.items.map(item => item.video_id)).not.toContain('history_processed_date');
  });

  it('localhost HTTP의 Naver OAuth state 쿠키는 Secure 없이 설정한다', async () => {
    const res = await request(app).get('/api/v1/auth/naver');
    expect(res.status).toBe(302);
    const stateCookie = res.headers['set-cookie']?.find(value => value.startsWith('cf_naver_state='));
    expect(stateCookie).toContain('HttpOnly');
    expect(stateCookie).toContain('SameSite=Lax');
    expect(stateCookie).not.toContain('Secure');
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

  it('TOP은 played만 집계하고 정렬을 전체 결과에 적용한 뒤 페이지를 자른다', async () => {
    const [topCafe] = await db('cafes').insert({ name: '정렬 카페', slug: 'topsortcafe', owner_email: 'topsort@t.com' }).returning('*');
    const rows = [];
    for (let index = 0; index < 11; index++) {
      rows.push(
        { cafe_id: topCafe.id, video_id: `count_${index}`, title: `재생 ${index}`, status: 'played', vote_count: 0 },
        { cafe_id: topCafe.id, video_id: `count_${index}`, title: `재생 ${index}`, status: 'played', vote_count: 0 },
      );
    }
    rows.push(
      { cafe_id: topCafe.id, video_id: 'vote_winner', title: '좋아요 우승', status: 'played', vote_count: 100 },
      { cafe_id: topCafe.id, video_id: 'rejected_spam', title: '거절 스팸', status: 'rejected', vote_count: 1000 },
      { cafe_id: topCafe.id, video_id: 'pending_spam', title: '대기 스팸', status: 'pending', vote_count: 1000 },
    );
    await db('recommendations').insert(rows);

    const countRes = await request(app).get(`/api/v1/cafes/${topCafe.slug}/recommendations/top10?sort=count`);
    const voteRes = await request(app).get(`/api/v1/cafes/${topCafe.slug}/recommendations/top10?sort=votes`);
    expect(countRes.status).toBe(200);
    expect(countRes.body.items.map(item => item.video_id)).not.toContain('vote_winner');
    expect(voteRes.body.items[0].video_id).toBe('vote_winner');
    expect(voteRes.body.items.map(item => item.video_id)).not.toContain('rejected_spam');
    expect(voteRes.body.items.map(item => item.video_id)).not.toContain('pending_spam');

    await db('cafes').where({ id: topCafe.id }).del();
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

  it('유효하지 않은 날짜는 history와 daily stats에서 400을 반환한다', async () => {
    expect((await authed('/api/v1/cafes/me/history?date=2026-02-29')).status).toBe(400);
    expect((await authed('/api/v1/cafes/me/stats/daily?date=not-a-date')).status).toBe(400);
  });

  it('사장님 이력·일별 통계도 IP와 visitor ID를 반환하지 않는다', async () => {
    const history = await authed('/api/v1/cafes/me/history');
    expect(history.status).toBe(200);
    for (const item of history.body.items) {
      expect(item).not.toHaveProperty('requester_ip');
      expect(item).not.toHaveProperty('visitor_id');
    }

    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const daily = await authed(`/api/v1/cafes/me/stats/daily?date=${today}`);
    expect(daily.status).toBe(200);
    for (const item of daily.body.byHour.flat()) {
      expect(item).not.toHaveProperty('requester_ip');
      expect(item).not.toHaveProperty('visitor_id');
    }
  });
});

describe('가입 완료 경합', () => {
  it('같은 pending token 재사용은 500 대신 409로 복구 안내한다', async () => {
    const pendingToken = issuePendingToken({ naverId: `replay-${Date.now()}`, email: 'replay@example.com', name: '재사용' });
    const body = {
      pendingToken,
      cafeName: '가입 재사용 테스트',
      agreed: true,
      agreements: { age: true, service: true, privacy: true, copyright: true },
      location: { region: '서울', district: '마포구', dong: '서교동' },
    };
    const first = await request(app).post('/api/v1/auth/complete').send(body);
    const replay = await request(app).post('/api/v1/auth/complete').send(body);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(409);
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

  it('DB의 현재 slug와 다른 토큰 → 401', async () => {
    const wrong = jwt.sign({ cafeId: cafe.id, slug: 'othercafe' }, JWT_SECRET, { expiresIn: '1h' });
    expect((await put(wrong, 'accepted')).status).toBe(401);
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

  it('accepted → pending으로 되돌릴 수 있다', async () => {
    const [target] = await db('recommendations').insert({
      cafe_id: cafe.id, video_id: 'return_to_pending', title: '되돌릴 곡', status: 'accepted',
    }).returning('*');
    const res = await request(app)
      .put(`/api/v1/cafes/${cafe.slug}/recommendations/${target.id}`)
      .set({ Authorization: `Bearer ${ownerToken}` })
      .send({ status: 'pending' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  it('동시 playing 요청 후에도 카페에는 한 곡만 playing으로 남는다', async () => {
    await db('recommendations').where({ cafe_id: cafe.id, status: 'playing' }).update({ status: 'played' });
    const targets = await db('recommendations').insert([
      { cafe_id: cafe.id, video_id: 'playing_race_a', title: '경쟁 A', status: 'accepted' },
      { cafe_id: cafe.id, video_id: 'playing_race_b', title: '경쟁 B', status: 'accepted' },
    ]).returning('*');

    const responses = await Promise.all(targets.map(target =>
      request(app)
        .put(`/api/v1/cafes/${cafe.slug}/recommendations/${target.id}`)
        .set({ Authorization: `Bearer ${ownerToken}` })
        .send({ status: 'playing' })
    ));

    expect(responses.every(response => response.status === 200)).toBe(true);
    expect(Number((await db('recommendations')
      .where({ cafe_id: cafe.id, status: 'playing' })
      .count('* as n').first()).n)).toBe(1);
  });

  it('종료 곡을 playing으로 요청해도 현재 재생곡을 종료하지 않는다', async () => {
    await db('recommendations').where({ cafe_id: cafe.id, status: 'playing' }).update({ status: 'played' });
    const [current, terminal] = await db('recommendations').insert([
      { cafe_id: cafe.id, video_id: 'playing_stays', title: '현재 재생', status: 'playing' },
      { cafe_id: cafe.id, video_id: 'terminal_target', title: '종료 대상', status: 'played' },
    ]).returning('*');

    const res = await request(app)
      .put(`/api/v1/cafes/${cafe.slug}/recommendations/${terminal.id}`)
      .set({ Authorization: `Bearer ${ownerToken}` })
      .send({ status: 'playing' });

    expect(res.status).toBe(409);
    expect((await db('recommendations').where({ id: current.id }).first()).status).toBe('playing');
  });
});
