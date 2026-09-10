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
  it('프롬프트를 고치면 버전이 바뀌고 이력에 남는다', async () => {
    const body = '들리는 것만 쓴다. 매장 배경음으로 맞는지도 한 줄 덧붙인다.';
    const saved = await request(app).put('/api/v1/admin/audio-settings')
      .set(admin()).send({ audio_llm_enabled: true, audio_llm_prompt: `  ${body}  ` });

    expect(saved.status).toBe(200);
    expect(saved.body.audio_llm_prompt).toBe(body, '앞뒤 공백은 지운다');
    expect(saved.body.audio_llm_prompt_version).toMatch(/^custom-[0-9a-f]{12}$/);
    // 워커가 claim 응답으로 같은 문장을 받아야 한다.
    expect((await db('audio_prompt_revisions').where({ body }).first())).toBeTruthy();

    // 비우면 워커 기본 문장으로 돌아간다. 이력은 남는다.
    const cleared = await request(app).put('/api/v1/admin/audio-settings')
      .set(admin()).send({ audio_llm_enabled: true, audio_llm_prompt: '' });
    expect(cleared.body.audio_llm_prompt).toBeNull();
    expect(cleared.body.audio_llm_prompt_version).toBe('audio-llm-1');
    expect((await db('audio_prompt_revisions').where({ body }).first())).toBeTruthy();
  });

  it('스위치만 바꾸는 요청은 저장한 프롬프트를 건드리지 않는다', async () => {
    // 필드를 안 보냈다고 지워버리면, Lab에서 스위치를 끄는 것만으로 프롬프트가 날아간다.
    const body = `보존 확인 ${Date.now()}`;
    await request(app).put('/api/v1/admin/audio-settings')
      .set(admin()).send({ audio_llm_enabled: true, audio_llm_prompt: body });

    const toggled = await request(app).put('/api/v1/admin/audio-settings')
      .set(admin()).send({ audio_llm_enabled: false });

    expect(toggled.status).toBe(200);
    expect(toggled.body.audio_llm_enabled).toBe(false);
    expect(toggled.body.audio_llm_prompt).toBe(body, '보내지 않은 필드는 그대로 둔다');
  });

  it('프롬프트 이력은 고치거나 지울 수 없다', async () => {
    const body = `불변 확인 ${Date.now()}`;
    await request(app).put('/api/v1/admin/audio-settings')
      .set(admin()).send({ audio_llm_enabled: true, audio_llm_prompt: body });
    await expect(db('audio_prompt_revisions').where({ body }).update({ body: '바꾼다' })).rejects.toThrow();
    await expect(db('audio_prompt_revisions').where({ body }).del()).rejects.toThrow();
  });

  it('지나치게 긴 프롬프트는 거절한다', async () => {
    const response = await request(app).put('/api/v1/admin/audio-settings')
      .set(admin()).send({ audio_llm_enabled: true, audio_llm_prompt: 'ㄱ'.repeat(4001) });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/4000/);
  });

  it('일괄 재분석은 먼저 대상 건수만 세어 준다', async () => {
    // 곡마다 외부 유료 API를 다시 부르므로, 몇 곡인지 모르고 누르게 하면 안 된다.
    const counted = await request(app).post('/api/v1/admin/audio-labels/requeue-rejected')
      .set(admin()).send({ dry_run: true });

    expect(counted.status).toBe(200);
    expect(counted.body.requeued).toBe(0, 'dry run은 큐를 건드리지 않는다');
    expect(Number.isSafeInteger(counted.body.eligible)).toBe(true);
  });

  it('틀림 보기를 조회 조건으로 받는다', async () => {
    const response = await request(app).get('/api/v1/admin/audio-labels?view=inaccurate').set(admin());
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.decisions)).toBe(true);
  });

  it('알 수 없는 보기는 거절한다', async () => {
    const response = await request(app).get('/api/v1/admin/audio-labels?view=wrong').set(admin());
    expect(response.status).toBe(400);
  });

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
