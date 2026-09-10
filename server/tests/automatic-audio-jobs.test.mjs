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
const metadata = (await import('../src/constants/maest-metadata.json', { with: { type: 'json' } })).default;
const contract = (await import('../src/constants/audio-pipeline.json', { with: { type: 'json' } })).default;
const normalization = (await import('../src/features/audio-analysis/normalization.js')).default;
let cafe;
const annotation = { artist_name: 'artist', track_version: 'unknown', tempo_class: 'moderate',
  mood_tags: ['peaceful'], instrumentation_type: 'acoustic', rhythmic_character: 'steady',
  vocal_type: 'none', genre_tags: ['jazz'], usage_scope: 'operational', note: null };
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
  const classes = metadata.classes;
  const output = { ...result(job), model_name: 'essentia-maest', model_version: `test+${contract.model_version}`,
    source_reference: `https://www.youtube.com/watch?v=${job.track_key}`,
    features: { duration_seconds: duration, sample_rate: 16000 } };
  return { lease_token: job.lease_token, result: output, automatic_annotation: { ...annotation, genre_tags: normalization.genreTags(normalization.normalize({ classes, mean: scores })), mood_tags: ['unknown'], vocal_type: 'unknown', instrumentation_type: 'unknown' },
    tag_scores: Object.fromEntries(classes.map((k) => [k, value])), maest_run: {
      schema_version: 1, pipeline_mode: 'MAEST_ONLY', sources_used: ['discogs-maest-30s-pw-519l-2'],
      maest_model_version: 'discogs-maest-30s-pw-519l-2', model_sha256: contract.model_sha256,
      audio_source_url: output.source_reference, audio_local_path: null, audio_sha256: 'b'.repeat(64),
      audio_duration_sec: duration, audio_sample_rate: 16000, audio_llm_raw: null,
      normalized: normalization.normalize({ classes, mean: scores }),
      maest_raw: { classes, mean: scores, max: scores, essentia_version: 'test',
        segments: Array.from({ length: count }, (_, i) => ({ start_sec: i * 15.008,
          end_sec: Math.min(duration, (i + 2) * 15.008), scores })),
        settings: { sample_rate: 16000, patch_size: 1876, patch_hop_size: 938, frame_hop: 256,
          last_patch_mode: 'repeat', resample_quality: 4, output: 'PartitionedCall/Identity_13', batch_size: 1 } },
    } };
}
// 감정 모델까지 돌린 실행. features와 normalized.mood가 같은 값을 가리켜야 한다.
function fullBody(job, valence = 0.7, arousal = 0.7) {
  const body = maestBody(job);
  body.result.features = { ...body.result.features, valence, arousal };
  body.maest_run.pipeline_mode = 'MAEST_EMOTION';
  body.maest_run.sources_used = ['discogs-maest-30s-pw-519l-2', 'msd-musicnn-1', 'deam-msd-musicnn-2'];
  body.maest_run.normalized.mood = { valence, arousal, source: 'deam-msd-musicnn-2', tags: ['joyful', 'uplifting'] };
  body.automatic_annotation = { ...body.automatic_annotation, mood_tags: ['joyful', 'uplifting'] };
  return body;
}
// 2단까지 돈 실행. audio_llm_raw의 입력 해시가 1단과 같은 파일을 가리켜야 한다.
function llmBody(job) {
  const body = fullBody(job);
  body.maest_run.pipeline_mode = 'FULL';
  body.maest_run.sources_used = [...body.maest_run.sources_used, 'google/gemini-2.5-pro'];
  body.maest_run.audio_llm_raw = {
    model_id: 'google/gemini-2.5-pro', prompt_version: 'audio-llm-1',
    input_sha256: body.maest_run.audio_sha256, description: '잔잔한 피아노가 이어진다',
    mood: ['차분함'], instruments: ['피아노'], vocal: ['보컬 없음'], structure: ['후반에 커진다'],
    segments: [{ start_sec: 0, duration_sec: 30 }, { start_sec: 15, duration_sec: 30 }],
  };
  return body;
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
  it('만료 lease의 보관 결과는 인계 전 복구하고 인계·관리 재실행 뒤에는 거절한다', async () => {
    await seed(); const old = await jobs.claim();
    await db('music_audio_jobs').where({ id: old.id }).update({ lease_until: new Date(0) });
    expect(await jobs.resume(old.id, old.lease_token)).toEqual({ status: 'processing' });
    await jobs.complete(old.id, old.lease_token, result(old), annotation, {});
    expect(await jobs.resume(old.id, old.lease_token)).toEqual({ status: 'completed' });
    const next = await jobs.requeue(old.id, old.generation);
    await expect(jobs.resume(old.id, old.lease_token)).rejects.toMatchObject({ status: 409 });
    await expect(jobs.requeue(old.id, old.generation)).rejects.toMatchObject({ status: 409 });
    expect(next.generation).toBe(2);
    const claimed = await jobs.claim();
    await expect(jobs.requeue(old.id, next.generation)).rejects.toMatchObject({ status: 409 });
    await db('music_audio_jobs').where({ id: old.id }).update({ lease_until: new Date(0) });
    await jobs.claim();
    await expect(jobs.resume(old.id, claimed.lease_token)).rejects.toMatchObject({ status: 409 });
  });
  it('일시 다운로드 오류는 세 번 이후에도 지연 재시도하고 영구 소스 오류는 중단한다', async () => {
    await seed(); const job = await jobs.claim();
    await db('music_audio_jobs').where({ id: job.id }).update({ attempts: 5 });
    expect(await jobs.fail(job.id, job.lease_token, 'DOWNLOAD_FAILED')).toEqual({ status: 'queued' });
    const row = await db('music_audio_jobs').where({ id: job.id }).first();
    expect(new Date(row.available_at).getTime() - Date.now()).toBeGreaterThan(5 * 3600 * 1000);
    await jobs.requeue(job.id, row.generation);
    const retried = await jobs.claim();
    expect(await jobs.fail(job.id, retried.lease_token, 'SOURCE_UNAVAILABLE')).toEqual({ status: 'failed' });
  });
  it('MAEST 중복 필드 불일치와 수동 결과 API 우회를 거절한다', async () => {
    await seed(); const job = await jobs.claim();
    const body = maestBody(job);
    body.automatic_annotation.genre_tags = ['unknown'];
    expect((await request(app).post(`/api/v1/audio-analysis/jobs/${job.id}/complete`).set(auth()).send(body)).status).toBe(400);
    const other = maestBody(job);
    other.tag_scores[metadata.classes[0]] = 0.9;
    expect((await request(app).post(`/api/v1/audio-analysis/jobs/${job.id}/complete`).set(auth()).send(other)).status).toBe(400);
    expect((await request(app).post('/api/v1/audio-analysis/results').set(auth()).send(body.result)).status).toBe(400);
    expect(await db('music_audio_runs').where({ track_key: job.track_key })).toHaveLength(0);
  });
  it('현재 택소노미 재적용은 원본·사람 라벨을 보존하고 중복 호출은 변경하지 않는다', async () => {
    await seed(); const job = await jobs.claim(); const body = llmBody(job);
    const first = await request(app).post(`/api/v1/audio-analysis/jobs/${job.id}/complete`).set(auth()).send(body);
    const runId = first.body.latest_run_id;
    const original = await db('music_audio_runs').where({ id: runId }).first();
    const { validateMusicAnnotation } = (await import('../src/features/music-labeling/annotation.js')).default;
    await labels.review(job.id, { annotation_revision: 1, audio_analysis_id: first.body.id, audio_analysis_revision: 1 },
      validateMusicAnnotation({ ...annotation, genre_tags: ['jazz'] }).value);
    await db('music_audio_analyses').where({ id: first.body.id }).update({ maest_summary: JSON.stringify({ normalized: { taxonomy_version: 'old' } }) });
    const input = { analysis_id: first.body.id, analysis_revision: 1, generation: job.generation };
    const admin = { Authorization: `Bearer ${issueAdminToken()}` };
    expect((await request(app).post(`/api/v1/admin/audio-labels/${job.id}/renormalize`).send(input)).status).toBe(401);
    const updated = await request(app).post(`/api/v1/admin/audio-labels/${job.id}/renormalize`).set(admin).send(input);
    expect(updated.status).toBe(200);
    expect(updated.body.revision).toBe(2);
    expect(updated.body.normalized.mood).toEqual(body.maest_run.normalized.mood);
    expect((await db('music_audio_runs').where({ id: runId }).first()).payload).toEqual(original.payload);
    expect((await db('music_track_annotations').where({ platform: job.platform, track_key: job.track_key }).first()).genre_tags).toEqual(['jazz']);
    expect((await request(app).post(`/api/v1/admin/audio-labels/${job.id}/renormalize`).set(admin).send(input)).status).toBe(409);
    const again = await request(app).post(`/api/v1/admin/audio-labels/${job.id}/renormalize`).set(admin).send({ ...input, analysis_revision: 2 });
    expect(again.body.unchanged).toBe(true);
    expect((await request(app).post(`/api/v1/admin/audio-labels/${job.id}/requeue`).send({ generation: 1 })).status).toBe(401);
  });
  it('빠른 확인은 미확정 필드와 아티스트를 정답으로 승격하지 않는다', async () => {
    await seed(); const job = await jobs.claim(); const body = maestBody(job);
    delete body.tag_scores; // 원시 점수 중복 제출 없이 서버가 파생한다.
    const saved = await request(app).post(`/api/v1/audio-analysis/jobs/${job.id}/complete`).set(auth()).send(body);
    const reviewed = await labels.review(job.id, { annotation_revision: 1, audio_analysis_id: saved.body.id, audio_analysis_revision: 1 }, null);
    expect(reviewed.track_annotation.artist_confirmed).toBe(false);
    expect(reviewed.track_annotation.reviewed_fields).toContain('genre_tags');
    expect(reviewed.track_annotation.reviewed_fields).not.toContain('mood_tags');
    expect(reviewed.track_annotation.reviewed_fields).not.toContain('vocal_type');
  });
  it('MAEST 큰 원본은 인증 경로에서 저장하고 재분석해도 이전 이력을 보존한다', async () => {
    await seed(); const job = await jobs.claim();
    // 계약의 길이 한도(600초) 안에서 최대 구간 수. 64KB 본문 경로를 그대로 지난다.
    const body = maestBody(job, 39, 0.3123456789);
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
  it('감정 모델까지 돌린 MAEST_EMOTION 실행을 저장하고 무드를 함께 남긴다', async () => {
    await seed(); const job = await jobs.claim();
    const response = await request(app).post(`/api/v1/audio-analysis/jobs/${job.id}/complete`)
      .set(auth()).send(fullBody(job));

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const [run] = await db('music_audio_runs').where({ track_key: job.track_key });
    expect(run.payload.pipeline_mode).toBe('MAEST_EMOTION');
    expect(run.payload.sources_used).toEqual(['discogs-maest-30s-pw-519l-2', 'msd-musicnn-1', 'deam-msd-musicnn-2']);
    expect(run.payload.normalized.mood.tags).toEqual(['joyful', 'uplifting']);
    expect(run.payload.audio_llm_raw).toBeNull();
  });
  it('무드와 features의 감정값이 어긋나면 거절한다', async () => {
    await seed(); const job = await jobs.claim();
    const body = fullBody(job);
    body.maest_run.normalized.mood.valence = 0.2;   // features는 0.7

    const response = await request(app).post(`/api/v1/audio-analysis/jobs/${job.id}/complete`).set(auth()).send(body);

    expect(response.status).toBe(400);
    expect(await db('music_audio_runs').where({ track_key: job.track_key })).toHaveLength(0);
  });
  it('감정 단계가 아닌 실행에 무드를 넣거나 모델 목록이 다르면 거절한다', async () => {
    await seed(); const job = await jobs.claim();
    const send = (b) => request(app).post(`/api/v1/audio-analysis/jobs/${job.id}/complete`).set(auth()).send(b);
    const withMood = maestBody(job);
    withMood.maest_run.normalized.mood = { valence: 0.5, arousal: 0.5, source: 'deam-msd-musicnn-2', tags: [] };
    expect((await send(withMood)).status).toBe(400);

    const wrongSources = fullBody(job);
    wrongSources.maest_run.sources_used = ['discogs-maest-30s-pw-519l-2'];
    expect((await send(wrongSources)).status).toBe(400);
  });
  it('2단 Audio LLM 원본을 자유 서술 그대로 보존한다', async () => {
    await seed(); const job = await jobs.claim();
    const response = await request(app).post(`/api/v1/audio-analysis/jobs/${job.id}/complete`)
      .set(auth()).send(llmBody(job));

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const [run] = await db('music_audio_runs').where({ track_key: job.track_key });
    expect(run.payload.pipeline_mode).toBe('FULL');
    expect(run.payload.audio_llm_raw.description).toBe('잔잔한 피아노가 이어진다');
    expect(run.payload.audio_llm_raw.instruments).toEqual(['피아노']);
    expect(run.payload.sources_used).toEqual(['discogs-maest-30s-pw-519l-2', 'msd-musicnn-1',
      'deam-msd-musicnn-2', 'google/gemini-2.5-pro']);
  });
  it('2단 원본의 입력 해시·모델·구간이 어긋나면 거절한다', async () => {
    await seed(); const job = await jobs.claim();
    const send = (b) => request(app).post(`/api/v1/audio-analysis/jobs/${job.id}/complete`).set(auth()).send(b);

    const wrongHash = llmBody(job);
    wrongHash.maest_run.audio_llm_raw.input_sha256 = 'c'.repeat(64);
    expect((await send(wrongHash)).status).toBe(400);

    const wrongModel = llmBody(job);
    wrongModel.maest_run.sources_used.pop();
    wrongModel.maest_run.sources_used.push('openai/gpt-4o-audio-preview');
    expect((await send(wrongModel)).status).toBe(400);

    const pastEnd = llmBody(job);
    pastEnd.maest_run.audio_llm_raw.segments = [{ start_sec: 0, duration_sec: 99999 }];
    expect((await send(pastEnd)).status).toBe(400);

    const emptyDescription = llmBody(job);
    emptyDescription.maest_run.audio_llm_raw.description = '';
    expect((await send(emptyDescription)).status).toBe(400);

    expect(await db('music_audio_runs').where({ track_key: job.track_key })).toHaveLength(0);
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
  it('틀렸다고 판정한 라벨은 사람 라벨로 승격하지 않는다', async () => {
    // 승격하면 label_source가 'automatic'이 아니게 되어 재분석과 정규화가 이 곡을
    // 건너뛴다. 틀렸다고 표시한 곡이 영영 갱신되지 않는 상태가 된다.
    await seed(); const job = await jobs.claim();
    const saved = await jobs.complete(job.id, job.lease_token, result(job), annotation, {});
    const key = { platform: job.platform, track_key: job.track_key };
    const before = await db('music_track_annotations').where(key).first();

    await labels.review(job.id, { verdict: 'inaccurate', annotation_revision: 1,
      audio_analysis_id: saved.id, audio_analysis_revision: 1 }, null);

    const after = await db('music_track_annotations').where(key).first();
    expect(after.human_review_status).toBe('inaccurate');
    expect(after.label_source).toBe('automatic');
    expect(after.reviewed_fields).toEqual(before.reviewed_fields);
    // 판정은 끝났으므로 검토 대기에서는 빠진다.
    expect((await labels.list({ view: 'ready' })).decisions).toHaveLength(0);
  });
  it('맞다고 판정한 라벨은 사람 라벨로 승격한다', async () => {
    await seed(); const job = await jobs.claim();
    const saved = await jobs.complete(job.id, job.lease_token, result(job), annotation, {});
    await labels.review(job.id, { verdict: 'confirmed', annotation_revision: 1,
      audio_analysis_id: saved.id, audio_analysis_revision: 1 }, null);
    const after = await db('music_track_annotations')
      .where({ platform: job.platform, track_key: job.track_key }).first();
    expect(after.human_review_status).toBe('confirmed');
    expect(after.label_source).toBe('human');
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
    expect((await service.fetchArtistLabels(options)).some((row) => row.id === item.track_annotation.id)).toBe(false);
    await labels.review(job.id, { annotation_revision: 2, audio_analysis_id: saved.id, audio_analysis_revision: 1, artist_confirmed: true }, null);
    expect((await service.fetchArtistLabels(options)).some((row) => row.id === item.track_annotation.id)).toBe(true);
    expect((await labels.list({ view: 'ready' })).decisions).toHaveLength(0);
  });
  it('익명은 작업을 가져오거나 검토할 수 없다', async () => {
    expect((await request(app).post('/api/v1/audio-analysis/jobs/claim').send({})).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/audio-labels')).status).toBe(401);
  });
});
