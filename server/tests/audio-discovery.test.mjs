// 최신곡 수집 큐. Lab 버튼이 요청을 쌓고 워커가 가져가 분석 큐를 채운다.
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
process.env.NODE_ENV = 'test';
// 이 파일이 직접 세팅하지 않으면 다른 테스트 파일이 먼저 돌아 값을 남겨주기를
// 기대하게 된다. 파일 순서가 바뀌면 워커 라우트가 통째로 503이 된다.
process.env.AUDIO_ANALYSIS_WORKER_TOKEN ||= 'discovery-worker-token';
const { app } = await import('../app.js');
const db = (await import('../src/db/knex.js')).default;
const { issueAdminToken } = await import('../src/utils/jwt.js');

const admin = () => ({ Authorization: `Bearer ${issueAdminToken()}` });
const worker = () => ({ Authorization: `Bearer ${process.env.AUDIO_ANALYSIS_WORKER_TOKEN}` });
const ask = (body) => request(app).post('/api/v1/admin/audio-discoveries').set(admin()).send(body);

beforeEach(async () => {
  await db('music_source_discoveries').del();
  await db('music_source_cursors').del();
  await db('music_audio_jobs').del();
});
afterAll(async () => {
  await db('music_source_discoveries').del();
  await db('music_source_cursors').del();
  await db('music_audio_jobs').del();
  await db.destroy();
});

describe('최신곡 수집 요청', () => {
  it('운영자 인증이 없으면 만들 수 없다', async () => {
    expect((await request(app).post('/api/v1/admin/audio-discoveries')
      .send({ source: 'apple_kr' })).status).toBe(401);
  });

  it('알 수 없는 소스와 범위를 벗어난 개수는 거절한다', async () => {
    expect((await ask({ source: 'spotify' })).status).toBe(400);
    expect((await ask({ source: 'apple_kr', limit: 0 })).status).toBe(400);
    expect((await ask({ source: 'apple_kr', limit: 999 })).status).toBe(400);
  });

  it('모든 소스가 검색어 없이 인기·발매 순서를 훑는다', async () => {
    // 검색어로 장르를 좁히면 거절해야 할 곡이 표본에서 빠진다.
    const created = await ask({ source: 'soundcloud' });

    expect(created.status).toBe(201);
    expect(created.body.discovery.query).toBeNull();
  });

  it('검색어를 보내도 저장하지 않는다', async () => {
    const created = await ask({ source: 'musicbrainz_kr', query: 'lo-fi' });

    expect(created.status).toBe(201);
    expect(created.body.discovery.query).toBeNull();
  });

  it('같은 소스의 대기 요청이 있으면 새로 쌓지 않는다', async () => {
    const first = await ask({ source: 'apple_kr', limit: 5 });
    expect(first.status).toBe(201);

    const second = await ask({ source: 'apple_kr', limit: 5 });

    expect(second.status).toBe(200);
    expect(second.body.already).toBe(true);
    expect(await db('music_source_discoveries')).toHaveLength(1);
  });

  it('워커가 가져가 곡을 제출하면 분석 큐에 들어간다', async () => {
    await ask({ source: 'apple_kr', limit: 5 });
    const claimed = await request(app).post('/api/v1/audio-analysis/discoveries/claim').set(worker());
    expect(claimed.status).toBe(200);
    expect(claimed.body.status).toBe('processing');

    const done = await request(app)
      .post(`/api/v1/audio-analysis/discoveries/${claimed.body.id}/complete`)
      .set(worker()).send({
        lease_token: claimed.body.lease_token,
        tracks: [{ platform: 'youtube', track_key: 'abcdefghijk', title: '노스탈지아', artist_name: 'BIG Naughty' }],
      });

    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.status).toBe('done');
    const [job] = await db('music_audio_jobs').where({ track_key: 'abcdefghijk' });
    expect(job.status).toBe('queued');
    expect(job.title).toBe('노스탈지아');
  });

  it('빈 큐에서 claim하면 204다', async () => {
    expect((await request(app).post('/api/v1/audio-analysis/discoveries/claim').set(worker())).status).toBe(204);
  });

  it('워커 토큰 없이는 claim할 수 없다', async () => {
    expect((await request(app).post('/api/v1/audio-analysis/discoveries/claim')).status).toBe(401);
  });

  it('잘못된 곡 목록과 만료된 lease는 거절한다', async () => {
    await ask({ source: 'apple_kr', limit: 5 });
    const claimed = await request(app).post('/api/v1/audio-analysis/discoveries/claim').set(worker());
    const send = (body) => request(app)
      .post(`/api/v1/audio-analysis/discoveries/${claimed.body.id}/complete`).set(worker()).send(body);

    expect((await send({ lease_token: claimed.body.lease_token,
      tracks: [{ platform: 'spotify', track_key: 'x', title: 'y' }] })).status).toBe(400);
    expect((await send({ lease_token: 'wrong-token', tracks: [] })).status).toBe(409);
    expect(await db('music_audio_jobs')).toHaveLength(0);
  });

  it('실패를 보고하면 재시도로 돌아간다', async () => {
    await ask({ source: 'apple_kr', limit: 5 });
    const claimed = await request(app).post('/api/v1/audio-analysis/discoveries/claim').set(worker());

    const failed = await request(app)
      .post(`/api/v1/audio-analysis/discoveries/${claimed.body.id}/fail`)
      .set(worker()).send({ lease_token: claimed.body.lease_token, error_code: 'SOURCE_FETCH_FAILED' });

    expect(failed.status).toBe(200);
    expect(failed.body.status).toBe('queued');
    expect(failed.body.error_code).toBe('SOURCE_FETCH_FAILED');
  });
});

// 순위 소스(Apple·SoundCloud)는 날짜가 아니라 offset으로 진도를 잡는다. 소스를 끝까지
// 보면 0으로 돌아가 그 사이 바뀐 차트를 다시 본다.
it.each(['apple_kr', 'soundcloud'])('%s는 요청마다 다음 구간을 보고 끝나면 처음으로 돌아간다', async (source) => {
  const claim = () => request(app).post('/api/v1/audio-analysis/discoveries/claim').set(worker());
  const finish = (job, scanned) => request(app)
    .post(`/api/v1/audio-analysis/discoveries/${job.id}/complete`).set(worker())
    .send({ lease_token: job.lease_token, tracks: [], offset: job.offset, scanned });
  const cursorOf = async () => (await db('music_source_cursors').where({ source }).first())?.next_offset;

  await ask({ source, limit: 20 });
  const first = (await claim()).body;
  expect(first.offset).toBe(0);
  // 요청한 만큼 다 훑었으면 아직 소스가 남았다는 뜻이다.
  expect((await finish(first, 20)).status).toBe(200);
  expect(await cursorOf()).toBe(20);

  await ask({ source, limit: 20 });
  const second = (await claim()).body;
  expect(second.offset).toBe(20);
  expect((await finish(second, 20)).status).toBe(200);
  expect(await cursorOf()).toBe(40);

  // 요청보다 적게 훑었으면 소스 끝이다. 다음 요청은 처음부터 본다.
  await ask({ source, limit: 20 });
  const third = (await claim()).body;
  expect(third.offset).toBe(40);
  expect((await finish(third, 7)).status).toBe(200);
  expect(await cursorOf()).toBe(0);

  await ask({ source, limit: 20 });
  expect((await claim()).body.offset).toBe(0);
});

it('날짜 창의 페이지를 소진한 뒤에만 날짜 진도를 옮긴다', async () => {
  const claim = () => request(app).post('/api/v1/audio-analysis/discoveries/claim').set(worker());
  const finish = (job, scanned, extra = {}) => request(app)
    .post(`/api/v1/audio-analysis/discoveries/${job.id}/complete`).set(worker()).send({
      lease_token: job.lease_token, tracks: [], offset: job.offset, window: job.window,
      page_schema_version: 1, scanned, ...extra });
  await ask({ source: 'musicbrainz_kr', limit: 20 });
  const first = (await claim()).body;
  expect(first.offset).toBe(0);
  expect((await finish(first, 20, { page_schema_version: 0 })).status).toBe(400);
  expect((await finish(first, 20)).status).toBe(200);
  let cursor = await db('music_source_cursors').where({ source: 'musicbrainz_kr' }).first();
  expect(cursor.covered_to).toBeNull(); expect(cursor.next_offset).toBe(20);
  expect(cursor.pending_window).toEqual(first.window);
  await ask({ source: 'musicbrainz_kr', limit: 20 }); const second = (await claim()).body;
  expect(second.window).toEqual(first.window); expect(second.offset).toBe(20);
  expect((await finish(second, 10, { offset: 0 })).status).toBe(400);
  expect((await finish(second, 10)).status).toBe(200);
  cursor = await db('music_source_cursors').where({ source: 'musicbrainz_kr' }).first();
  expect(cursor.pending_window).toBeNull(); expect(cursor.next_offset).toBe(0);
  const dates = await db('music_source_cursors').select(db.raw('covered_to::text as covered_to')).where({ source: 'musicbrainz_kr' }).first();
  expect(dates.covered_to).toBe(first.window.to);
});
