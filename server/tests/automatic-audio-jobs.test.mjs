import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.AUDIO_ANALYSIS_WORKER_TOKEN ||= 'test-automatic-worker';
const { app } = await import('../app.js');
const db = (await import('../src/db/knex.js')).default;
const jobs = (await import('../src/features/audio-analysis/jobs.js')).default;
const labels = (await import('../src/features/audio-analysis/labels.js')).default;
const analyses = (await import('../src/features/audio-analysis/service.js')).default;
const recService = (await import('../src/services/recommendation.service.js')).default;
const { issueAdminToken } = await import('../src/utils/jwt.js');
let cafe;
const annotation = { artist_name: 'artist', track_version: 'unknown', tempo_class: 'moderate',
  mood_tags: ['peaceful'], instrumentation_type: 'acoustic', rhythmic_character: 'steady',
  vocal_type: 'none', genre_tags: ['jazz'], usage_scope: 'evaluation', note: null };
function result(job) {
  return { platform: job.platform, track_key: job.track_key, model_name: 'essentia-standard',
    model_version: 'test-tags-1', feature_schema_version: 1, rights_basis: 'platform_stream',
    source_reference: 'youtube:test', features: { duration_seconds: 100, sample_rate: 44100 },
    suggested_annotation: {}, analyzed_at: new Date() };
}
async function seed(platform = 'youtube') {
  return recService.add(cafe.id, { videoId: crypto.randomUUID().slice(0, 11), title: 'track',
    channelTitle: 'artist', platform, requesterIp: '127.0.0.1' });
}
const auth = () => ({ Authorization: `Bearer ${process.env.AUDIO_ANALYSIS_WORKER_TOKEN}` });
function maestBody(job, count = 3, value = 0.3) {
  const duration = count * 15.008;
  const scores = Array(519).fill(value);
  const classes = Array.from({ length: 519 }, (_, i) => `Jazz---Style ${i}`);
  const output = { ...result(job), model_name: 'essentia-maest',
    source_reference: `https://www.youtube.com/watch?v=${job.track_key}`,
    features: { duration_seconds: duration, sample_rate: 16000 } };
  return { lease_token: job.lease_token, result: output, automatic_annotation: annotation,
    tag_scores: Object.fromEntries(classes.map((k) => [k, value])), maest_run: {
      schema_version: 1, pipeline_mode: 'MAEST_ONLY', sources_used: ['discogs-maest-30s-pw-519l-2'],
      maest_model_version: 'discogs-maest-30s-pw-519l-2', model_sha256: 'a'.repeat(64),
      audio_source_url: output.source_reference, audio_local_path: null, audio_sha256: 'b'.repeat(64),
      audio_duration_sec: duration, audio_sample_rate: 16000, audio_llm_raw: null,
      normalized: { taxonomy_version: 'test-1', calibrated: false, genre: [], mood: null },
      maest_raw: { classes, mean: scores, max: scores, essentia_version: 'test',
        segments: Array.from({ length: count }, (_, i) => ({ start_sec: i * 15.008,
          end_sec: Math.min(duration, (i + 2) * 15.008), scores })),
        settings: { sample_rate: 16000, patch_size: 1876, patch_hop_size: 938, frame_hop: 256,
          last_patch_mode: 'repeat', resample_quality: 4, output: 'PartitionedCall/Identity_13', batch_size: 1 } },
    } };
}
beforeAll(async () => {
  [cafe] = await db('cafes').insert({ slug: `audio-${Date.now()}`, name: 'audio test', owner_email: 'audio@example.test' }).returning('*');
});
beforeEach(async () => { await db('music_audio_jobs').del(); });
afterAll(async () => {
  await db('music_audio_jobs').del();
  await db('cafes').where({ id: cafe.id }).del();
  await db.destroy();
});
describe('자동 음향 분석 파이프라인', () => {
  it('MAEST 큰 원본은 인증 경로에서 저장하고 재분석해도 이전 이력을 보존한다', async () => {
    await seed(); const job = await jobs.claim();
    const body = maestBody(job, 50, 0.3123456789);
    expect(JSON.stringify(body).length).toBeGreaterThan(65536);
    const send = (j, b) => request(app).post(`/api/v1/audio-analysis/jobs/${j.id}/complete`).set(auth()).send(b);
    const first = await send(job, body);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const originalId = first.body.latest_run_id;
    expect((await send(job, body)).body.replayed).toBe(true);
    await db('music_audio_jobs').where({ id: job.id }).update({ status: 'queued' });
    const second = await jobs.claim();
    expect((await send(second, maestBody(second, 3, 0.6))).status).toBe(200);
    const records = await db('music_audio_runs').where({ platform: job.platform, track_key: job.track_key });
    expect(records).toHaveLength(2);
    expect(records.find((v) => v.id === originalId).payload.maest_raw.mean[0]).toBe(0.3123456789);
    await expect(db.transaction((trx) => trx('music_audio_runs').where({ id: originalId }).update({ payload: '{}' }))).rejects.toThrow('append-only');
    await expect(db.transaction((trx) => trx('music_audio_runs').where({ id: originalId }).del())).rejects.toThrow('append-only');
    expect((await request(app).get(`/api/v1/admin/audio-runs/${originalId}`)).status).toBe(401);
    const read = await request(app).get(`/api/v1/admin/audio-runs/${originalId}`)
      .set({ Authorization: `Bearer ${issueAdminToken()}` });
    expect(read.status).toBe(200);
    expect(read.body).not.toHaveProperty('lease_token');
    expect(read.body.payload.audio_llm_raw).toBeNull();
  });
  it('MAEST 구간 누락·집계 불일치는 완료와 원본 저장을 모두 거절한다', async () => {
    await seed(); const job = await jobs.claim();
    const body = maestBody(job);
    body.maest_run.maest_raw.mean[0] = 0.9;
    // 배열을 공유한 테스트 입력을 복제한 뒤 max도 변하므로 구간 값만 원복한다.
    const malformed = JSON.parse(JSON.stringify(body));
    malformed.maest_run.maest_raw.segments.forEach((s) => { s.scores[0] = 0.3; });
    const response = await request(app).post(`/api/v1/audio-analysis/jobs/${job.id}/complete`).set(auth()).send(malformed);
    expect(response.status).toBe(400);
    expect(await db('music_audio_runs').where({ track_key: job.track_key })).toHaveLength(0);
    expect((await db('music_audio_jobs').where({ id: job.id }).first()).status).toBe('processing');
  });
  it('필터 OFF 신청도 자동 등록하고 동일 곡 재신청은 중복 작업을 만들지 않는다', async () => {
    const rec = await seed();
    expect(await db('music_audio_jobs').where({ track_key: rec.video_id })).toHaveLength(1);
    await jobs.enqueue(rec);
    expect(await db('music_audio_jobs').where({ track_key: rec.video_id })).toHaveLength(1);
    const listing = await labels.list({ view: 'all' });
    expect(listing.decisions[0].video_id).toBe(rec.video_id);
    expect(listing.decisions[0]).not.toHaveProperty('lease_token');
  });
  it('Spotify는 미지원으로 보관하고 claim하지 않는다', async () => {
    await seed('spotify');
    expect(await jobs.claim()).toBeNull();
    expect((await labels.list({ view: 'all' })).decisions[0].job_status).toBe('unsupported');
  });
  it('동시 claim은 같은 작업을 두 워커에 주지 않는다', async () => {
    await seed();
    const claimed = await Promise.all([jobs.claim(), jobs.claim()]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
  });
  it('만료 작업을 새 lease로 회수하고 이전 워커의 결과를 거절한다', async () => {
    await seed();
    const old = await jobs.claim();
    await db('music_audio_jobs').where({ id: old.id }).update({ lease_until: new Date(0) });
    const renewed = await jobs.claim();
    expect(renewed.id).toBe(old.id);
    expect(renewed.lease_token).not.toBe(old.lease_token);
    await expect(jobs.complete(old.id, old.lease_token, result(old), annotation, {})).rejects.toMatchObject({ status: 409 });
  });
  it('세 번 중단된 작업은 실패로 남기고 다른 곡은 계속 처리한다', async () => {
    await seed();
    const old = await jobs.claim();
    await db('music_audio_jobs').where({ id: old.id }).update({ lease_until: new Date(0), attempts: 3 });
    expect(await jobs.claim()).toBeNull();
    expect((await db('music_audio_jobs').where({ id: old.id }).first()).status).toBe('failed');
  });
  it('자동 라벨을 즉시 저장하고 같은 완료 요청의 재전송은 revision을 올리지 않는다', async () => {
    await seed(); const job = await jobs.claim();
    const body = { lease_token: job.lease_token, result: result(job), automatic_annotation: annotation, tag_scores: { jazz: 0.7 } };
    const response = await request(app).post(`/api/v1/audio-analysis/jobs/${job.id}/complete`).set(auth()).send(body);
    expect(response.status).toBe(200);
    const again = await request(app).post(`/api/v1/audio-analysis/jobs/${job.id}/complete`).set(auth()).send(body);
    expect(again.body.replayed).toBe(true);
    const item = (await labels.list({ view: 'unreviewed' })).decisions[0];
    expect(item.track_annotation.label_source).toBe('automatic');
    expect(item.audio_analysis.automatic_annotation.genre_tags).toEqual(['jazz']);
    expect(item.audio_analysis.revision).toBe(1);
    const review = await request(app).put(`/api/v1/admin/audio-labels/${job.id}/review`)
      .set({ Authorization: `Bearer ${issueAdminToken()}` }).send({ annotation_revision: 1,
        audio_analysis_id: response.body.id, audio_analysis_revision: 1 });
    expect(review.status).toBe(200);
    expect((await labels.list({ view: 'reviewed' })).summary.reviewed).toBe(1);
  });
  it('다른 곡 결과와 잘못된 자동 라벨은 저장하지 않는다', async () => {
    await seed(); const job = await jobs.claim();
    await expect(jobs.complete(job.id, job.lease_token, { ...result(job), track_key: 'wrong' }, annotation, {})).rejects.toMatchObject({ status: 409 });
    await expect(jobs.complete(job.id, job.lease_token, result(job), { ...annotation, mood_tags: [] }, {})).rejects.toMatchObject({ status: 400 });
    expect((await db('music_audio_jobs').where({ id: job.id }).first()).status).toBe('processing');
  });
  it('같은 ID의 재분석과 경쟁하는 오래된 검토는 전체 롤백한다', async () => {
    await seed(); const job = await jobs.claim();
    const saved = await jobs.complete(job.id, job.lease_token, result(job), annotation, {});
    await analyses.saveResult(result(job));
    await expect(labels.review(job.id, { annotation_revision: 1, audio_analysis_id: saved.id, audio_analysis_revision: 1 }, null))
      .rejects.toMatchObject({ status: 409 });
    expect((await db('music_audio_analyses').where({ id: saved.id }).first()).review_status).toBe('pending');
  });
  it('사람이 수정한 라벨은 재분석해도 보존한다', async () => {
    await seed(); const job = await jobs.claim();
    const saved = await jobs.complete(job.id, job.lease_token, result(job), annotation, {});
    const { validateMusicAnnotation } = (await import('../src/features/music-labeling/annotation.js')).default;
    const human = validateMusicAnnotation({ ...annotation, mood_tags: ['joyful'] }).value;
    await labels.review(job.id, { annotation_revision: 1, audio_analysis_id: saved.id, audio_analysis_revision: 1 }, human);
    await db('music_audio_jobs').where({ id: job.id }).update({ status: 'queued' });
    const second = await jobs.claim();
    await jobs.complete(second.id, second.lease_token, result(second), annotation, {});
    const current = await db('music_track_annotations').where({ platform: job.platform, track_key: job.track_key }).first();
    expect(current.mood_tags).toEqual(['joyful']);
    expect(current.label_source).toBe('human');
    expect((await labels.list({ view: 'unreviewed' })).decisions).toHaveLength(1);
  });
  it('자동 라벨은 확인한 아티스트 참고 자료에 섞지 않는다', async () => {
    await seed(); const job = await jobs.claim();
    expect((await labels.list({ view: 'ready' })).decisions).toHaveLength(0);
    const saved = await jobs.complete(job.id, job.lease_token, result(job), annotation, {});
    const item = (await labels.list({ view: 'ready' })).decisions[0];
    const service = (await import('../src/features/music-labeling/review.service.js')).default;
    const options = { artistKey: 'artist', platform: job.platform, trackKey: 'different-track' };
    expect((await service.fetchArtistLabels(options)).some((row) => row.id === item.track_annotation.id)).toBe(false);
    await labels.review(job.id, { annotation_revision: 1, audio_analysis_id: saved.id, audio_analysis_revision: 1 }, null);
    expect((await service.fetchArtistLabels(options)).some((row) => row.id === item.track_annotation.id)).toBe(true);
    expect((await labels.list({ view: 'ready' })).decisions).toHaveLength(0);
  });
  it('익명은 작업을 가져오거나 검토할 수 없다', async () => {
    expect((await request(app).post('/api/v1/audio-analysis/jobs/claim').send({})).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/audio-labels')).status).toBe(401);
  });
});
