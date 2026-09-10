// 최신곡 수집 큐. Lab 버튼이 요청을 쌓고 워커가 가져가 분석 큐를 채운다.
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
process.env.NODE_ENV = 'test';
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
    // SoundCloud는 키워드 검색이라 검색어 없이는 만들 수 없다.
    expect((await ask({ source: 'soundcloud' })).status).toBe(400);
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
