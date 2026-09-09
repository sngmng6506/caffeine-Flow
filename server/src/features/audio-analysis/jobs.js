const crypto = require('crypto');
const db = require('../../db/knex');
const analysisService = require('./service');
const { validateMusicAnnotation } = require('../music-labeling/annotation');
const { JOB_MAX_ATTEMPTS, JOB_LEASE_MINUTES } = require('../../constants/audio-analysis');
const conflict = () => Object.assign(new Error('작업이 만료되었거나 이미 변경되었습니다'), { status: 409 });

async function enqueue(rec, connection = db) {
  const supported = ['youtube', 'soundcloud'].includes(rec.platform);
  await connection('music_audio_jobs').insert({
    platform: rec.platform, track_key: rec.video_id, title: rec.title,
    artist_name: (rec.channel_title || 'unknown').slice(0, 200),
    status: supported ? 'queued' : 'unsupported',
    error_code: supported ? null : 'PLATFORM_UNSUPPORTED',
  }).onConflict(['platform', 'track_key']).ignore();
}

function claim() {
  return db.transaction(async (trx) => {
    // 강제 종료된 워커의 lease도 재시도 한도 내에서 회수한다.
    await trx('music_audio_jobs').where({ status: 'processing' })
      .where('lease_until', '<', trx.fn.now()).update({
        status: trx.raw("CASE WHEN attempts >= ? THEN 'failed' ELSE 'queued' END", [JOB_MAX_ATTEMPTS]),
        lease_token: null, lease_until: null, error_code: 'LEASE_EXPIRED', updated_at: trx.fn.now(),
      });
    const row = await trx('music_audio_jobs').where({ status: 'queued' })
      .where('available_at', '<=', trx.fn.now()).orderBy('available_at').orderBy('id')
      .forUpdate().skipLocked().first();
    if (!row) return null;
    const [job] = await trx('music_audio_jobs').where({ id: row.id }).update({
      status: 'processing', attempts: row.attempts + 1, lease_token: crypto.randomUUID(),
      lease_until: trx.raw("now() + (? * interval '1 minute')", [JOB_LEASE_MINUTES]),
      updated_at: trx.fn.now(),
    }).returning('*');
    return job;
  });
}

async function lockedJob(trx, id, token) {
  const job = await trx('music_audio_jobs').where({ id }).forUpdate().first();
  if (!job || job.lease_token !== token) throw conflict();
  return job;
}

function complete(id, token, result, automaticAnnotation, tagScores, maestRun = null) {
  return db.transaction(async (trx) => {
    const job = await lockedJob(trx, id, token);
    // 제출 응답만 유실된 재전송은 라벨을 다시 갱신하지 않는다.
    if (job.status === 'completed') return { id: job.analysis_id, replayed: true };
    if (job.status !== 'processing' || new Date(job.lease_until) <= new Date()) throw conflict();
    if (job.platform !== result.platform || job.track_key !== result.track_key) throw conflict();
    const checked = validateMusicAnnotation({ ...automaticAnnotation, artist_name: job.artist_name, usage_scope: 'evaluation' });
    if (checked.error) throw Object.assign(new Error(checked.error), { status: 400 });
    const automatic = checked.value;
    let runFields = {};
    if (maestRun) {
      const checkedRun = require('./runs').validateRun(maestRun, result);
      if (checkedRun.error) throw Object.assign(new Error(checkedRun.error), { status: 400 });
      const [run] = await trx('music_audio_runs').insert({ lease_token: token, platform: job.platform,
        track_key: job.track_key, payload: JSON.stringify({ ...checkedRun.value, result, automatic_annotation: automatic }) }).returning('id');
      runFields = { latest_run_id: run.id, maest_summary: require('./runs').summary(checkedRun.value) };
    }
    const saved = await analysisService.saveResult({ ...result, automatic_annotation: automatic, tag_scores: tagScores, ...runFields }, trx);
    const row = {
      ...automatic, platform: job.platform, track_key: job.track_key, title: job.title,
      mood_tags: JSON.stringify(automatic.mood_tags), genre_tags: JSON.stringify(automatic.genre_tags),
      label_source: 'automatic', human_review_status: 'unreviewed', updated_at: trx.fn.now(),
    };
    // DB 안에서 조건을 평가하므로 사람 편집과 경합해도 덮어쓰지 않는다.
    await trx('music_track_annotations').insert(row).onConflict(['platform', 'track_key'])
      .merge({ ...row, revision: trx.raw('music_track_annotations.revision + 1') })
      .where('music_track_annotations.label_source', 'automatic');
    await trx('music_audio_jobs').where({ id }).update({
      status: 'completed', analysis_id: saved.id, error_code: null, lease_until: null, updated_at: trx.fn.now(),
    });
    return saved;
  });
}

function fail(id, token, errorCode) {
  return db.transaction(async (trx) => {
    const job = await lockedJob(trx, id, token);
    if (job.status !== 'processing' || new Date(job.lease_until) <= new Date()) throw conflict();
    const retry = job.attempts < JOB_MAX_ATTEMPTS;
    await trx('music_audio_jobs').where({ id }).update({
      status: retry ? 'queued' : 'failed', error_code: errorCode,
      available_at: trx.raw("now() + (? * interval '1 minute')", [2 ** job.attempts]),
      lease_token: null, lease_until: null, updated_at: trx.fn.now(),
    });
    return { status: retry ? 'queued' : 'failed' };
  });
}
module.exports = { enqueue, claim, complete, fail };
