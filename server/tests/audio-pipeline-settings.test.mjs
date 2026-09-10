// 3단 Audio LLM 스위치. 운영자가 Lab에서 끄면 워커가 다음 곡부터 따라야 한다.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
process.env.NODE_ENV = 'test';
const { app } = await import('../app.js');
const db = (await import('../src/db/knex.js')).default;
const jobs = (await import('../src/features/audio-analysis/jobs.js')).default;
const recService = (await import('../src/services/recommendation.service.js')).default;
const { issueAdminToken } = await import('../src/utils/jwt.js');

const admin = () => ({ Authorization: `Bearer ${issueAdminToken()}` });
let cafe;

beforeAll(async () => {
  [cafe] = await db('cafes').insert({ slug: `audio-set-${Date.now()}`, name: 'settings test',
    owner_email: 'settings@example.test' }).returning('*');
});
beforeEach(async () => {
  await db('music_audio_jobs').del();
  await db('audio_pipeline_settings').where({ id: 1 }).update({ audio_llm_enabled: true });
});
afterAll(async () => {
  await db('music_audio_jobs').del();
  await db('cafes').where({ id: cafe.id }).del();
  await db.destroy();
});

describe('자동 분석 판정', () => {
  it('알 수 없는 판정은 거절한다', async () => {
    const response = await request(app).put('/api/v1/admin/audio-labels/00000000-0000-0000-0000-000000000000/review')
      .set(admin()).send({ verdict: 'maybe', annotation_revision: 0 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/판정/);
  });

  it('판정 없이 보내는 기존 경로도 그대로 받는다', async () => {
    // 택소노미를 고르지 않고 확인만 하는 경로가 깨지면 안 된다.
    const response = await request(app).put('/api/v1/admin/audio-labels/00000000-0000-0000-0000-000000000000/review')
      .set(admin()).send({ annotation_revision: 0 });

    expect(response.status).toBe(404, '판정 검증이 아니라 곡을 못 찾아 실패해야 한다');
  });
});

describe('3단 Audio LLM 스위치', () => {
  it('기본값은 켜짐이다', async () => {
    const response = await request(app).get('/api/v1/admin/audio-settings').set(admin());

    expect(response.status).toBe(200);
    expect(response.body.audio_llm_enabled).toBe(true);
  });

  it('운영자 인증 없이는 읽지도 바꾸지도 못한다', async () => {
    expect((await request(app).get('/api/v1/admin/audio-settings')).status).toBe(401);
    expect((await request(app).put('/api/v1/admin/audio-settings')
      .send({ audio_llm_enabled: false })).status).toBe(401);
  });

  it('끄면 값이 남고 claim 응답이 따라간다', async () => {
    await recService.add(cafe.id, { videoId: crypto.randomUUID().slice(0, 11), title: 'track',
      channelTitle: 'artist', platform: 'youtube', requesterIp: '127.0.0.1' });

    const off = await request(app).put('/api/v1/admin/audio-settings')
      .set(admin()).send({ audio_llm_enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.audio_llm_enabled).toBe(false);

    // 워커는 별도 조회 없이 claim 응답만으로 판단한다.
    expect((await jobs.claim()).audio_llm_enabled).toBe(false);
    expect((await request(app).get('/api/v1/admin/audio-settings').set(admin()))
      .body.audio_llm_enabled).toBe(false);
  });

  it('boolean이 아닌 값은 거절한다', async () => {
    for (const value of ['false', 1, null, undefined]) {
      const response = await request(app).put('/api/v1/admin/audio-settings')
        .set(admin()).send({ audio_llm_enabled: value });
      expect(response.status, `값 ${JSON.stringify(value)}`).toBe(400);
    }
    expect((await request(app).get('/api/v1/admin/audio-settings').set(admin()))
      .body.audio_llm_enabled).toBe(true);
  });
});
