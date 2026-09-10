const crypto = require('crypto');
const db = require('../../db/knex');
const analysisService = require('./service');
const { validateMusicAnnotation } = require('../music-labeling/annotation');
const { JOB_MAX_ATTEMPTS, JOB_LEASE_MINUTES } = require('../../constants/audio-analysis');
const { retry } = require('../../constants/audio-pipeline.json');
const { genreTags } = require('./normalization');
const conflict = () => Object.assign(new Error('작업이 만료되었거나 이미 변경되었습니다'), { status: 409 });

async function enqueue(rec, connection = db) {
  const supported = ['youtube', 'soundcloud'].includes(rec.platform);
  // 이미 있는 곡은 무시한다. 상태가 completed든 failed든 건드리지 않는다.
  // 새로 들어갔는지 돌려주어 호출부가 진도를 셀 수 있게 한다.
  const inserted = await connection('music_audio_jobs').insert({
    platform: rec.platform, track_key: rec.video_id, title: rec.title,
    artist_name: (rec.channel_title || 'unknown').slice(0, 200),
    status: supported ? 'queued' : 'unsupported',
    error_code: supported ? null : 'PLATFORM_UNSUPPORTED',
  }).onConflict(['platform', 'track_key']).ignore().returning('id');
  return inserted.length > 0;
}

function claim() {
  return db.transaction(async (trx) => {
    // 강제 종료된 워커의 lease도 재시도 한도 내에서 회수한다.
    await trx('music_audio_jobs').where({ status: 'processing' })
      .where('lease_until', '<', trx.fn.now()).update({
        status: trx.raw("CASE WHEN attempts >= ? THEN 'failed' ELSE 'queued' END", [JOB_MAX_ATTEMPTS]),
        lease_until: null, error_code: 'LEASE_EXPIRED', updated_at: trx.fn.now(),
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
    // 3단 실행 여부는 서버가 정한다. 워커가 따로 조회하지 않도록 함께 실어 보낸다.
    const settings = await trx('audio_pipeline_settings').where({ id: 1 }).first();
    // 3단 실행 여부와 프롬프트는 서버가 단일 기준이다. 워커 환경변수로 되돌리지 않는다.
    return { ...job,
      audio_llm_enabled: settings ? settings.audio_llm_enabled : true,
      audio_llm_prompt: settings?.audio_llm_prompt || null };
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
    if (result.model_name === 'essentia-maest' && !maestRun) throw Object.assign(new Error('MAEST 원본이 필요합니다'), { status: 400 });
    if (maestRun) {
      const checkedRun = require('./runs').validateRun(maestRun, result);
      if (checkedRun.error) throw Object.assign(new Error(checkedRun.error), { status: 400 });
      const raw = checkedRun.value.maest_raw;
      const derivedScores = Object.fromEntries(raw.classes.map((name, i) => [name, raw.mean[i]]));
      if (tagScores && (Object.keys(tagScores).length !== raw.classes.length || raw.classes.some((name, i) => Math.abs(tagScores[name] - raw.mean[i]) > 0.000001 || !Number.isFinite(tagScores[name])))) {
        throw Object.assign(new Error('원본과 태그 점수가 다릅니다'), { status: 400 });
      }
      if (JSON.stringify(automatic.genre_tags) !== JSON.stringify(genreTags(checkedRun.value.normalized)) ||
          JSON.stringify(automatic.mood_tags) !== JSON.stringify(checkedRun.value.normalized.mood?.tags?.length ? checkedRun.value.normalized.mood.tags : ['unknown']) || automatic.vocal_type !== 'unknown' || automatic.instrumentation_type !== 'unknown') {
        throw Object.assign(new Error('원본과 자동 라벨이 다릅니다'), { status: 400 });
      }
      tagScores = derivedScores;
      const [run] = await trx('music_audio_runs').insert({ lease_token: token, platform: job.platform,
        track_key: job.track_key, payload: JSON.stringify({ ...checkedRun.value, result, automatic_annotation: automatic }) }).returning('id');
      runFields = { latest_run_id: run.id, maest_summary: require('./runs').summary(checkedRun.value) };
    }
    const saved = await analysisService.saveResult({ ...result, automatic_annotation: automatic, tag_scores: tagScores, ...runFields }, trx);
    const row = {
      ...automatic, platform: job.platform, track_key: job.track_key, title: job.title,
      mood_tags: JSON.stringify(automatic.mood_tags), genre_tags: JSON.stringify(automatic.genre_tags),
      label_source: 'automatic', human_review_status: 'unreviewed', artist_confirmed: false, reviewed_fields: '[]', updated_at: trx.fn.now(),
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
    const infrastructure = retry.infrastructure_codes.includes(errorCode);
    const temporary = retry.temporary_codes.includes(errorCode);
    const again = infrastructure || temporary || (!retry.permanent_codes.includes(errorCode) && job.attempts < JOB_MAX_ATTEMPTS);
    const delay = infrastructure ? retry.cooldown_seconds / 60 : temporary && job.attempts >= JOB_MAX_ATTEMPTS
      ? retry.long_retry_minutes : 2 ** Math.min(job.attempts, JOB_MAX_ATTEMPTS);
    await trx('music_audio_jobs').where({ id }).update({
      status: again ? 'queued' : 'failed', error_code: errorCode,
      available_at: trx.raw("now() + (? * interval '1 minute')", [delay]),
      lease_token: null, lease_until: null, updated_at: trx.fn.now(),
    });
    return { status: again ? 'queued' : 'failed' };
  });
}
// 아직 다른 워커가 가져가지 않은 만료 lease만 결과 전송을 위해 갱신한다.
function resume(id, token) {
  return db.transaction(async (trx) => {
    const job = await lockedJob(trx, id, token);
    if (job.status === 'completed') return { status: 'completed' };
    if (!['processing', 'queued'].includes(job.status) && job.error_code !== 'LEASE_EXPIRED') throw conflict();
    await trx('music_audio_jobs').where({ id }).update({ status: 'processing',
      lease_until: trx.raw("now() + (? * interval '1 minute')", [JOB_LEASE_MINUTES]), updated_at: trx.fn.now() });
    return { status: 'processing' };
  });
}

function requeue(id, generation) {
  return db.transaction(async (trx) => {
    const job = await trx('music_audio_jobs').where({ id }).forUpdate().first();
    if (!job) throw Object.assign(new Error('곡을 찾을 수 없습니다'), { status: 404 });
    if (job.generation !== generation || job.status === 'processing') throw conflict();
    if (!['youtube', 'soundcloud'].includes(job.platform)) throw Object.assign(new Error('지원하지 않는 플랫폼입니다'), { status: 400 });
    const [saved] = await trx('music_audio_jobs').where({ id }).update({ status: 'queued', attempts: 0,
      generation: job.generation + 1, lease_token: null, lease_until: null, error_code: null,
      available_at: trx.fn.now(), updated_at: trx.fn.now() }).returning(['id', 'status', 'generation']);
    return saved;
  });
}
// 틀림으로 표시한 곡을 한 번에 다시 큐에 넣는다. 프롬프트를 고친 뒤 그 곡들만
// 다시 돌리는 것이 이 기능의 목적이라, 대상은 사람이 틀렸다고 표시한 것으로 한정한다.
// 처리 중인 곡과 자동 분석을 지원하지 않는 플랫폼은 건너뛴다.
function requeueRejected() {
  return db.transaction(async (trx) => {
    const rows = await trx({ job: 'music_audio_jobs' })
      .join({ annotation: 'music_track_annotations' }, function () {
        this.on('annotation.platform', 'job.platform').andOn('annotation.track_key', 'job.track_key');
      })
      .whereIn('annotation.human_review_status', ['inaccurate', 'unclear'])
      .whereNot('job.status', 'processing')
      .whereIn('job.platform', ['youtube', 'soundcloud'])
      .forUpdate().of('job')
      .select('job.id', 'job.generation');
    if (!rows.length) return { requeued: 0 };
    await trx('music_audio_jobs').whereIn('id', rows.map((row) => row.id)).update({
      status: 'queued', attempts: 0, generation: trx.raw('generation + 1'),
      lease_token: null, lease_until: null, error_code: null,
      available_at: trx.fn.now(), updated_at: trx.fn.now(),
    });
    return { requeued: rows.length };
  });
}

module.exports = { enqueue, claim, complete, fail, resume, requeue, requeueRejected };
