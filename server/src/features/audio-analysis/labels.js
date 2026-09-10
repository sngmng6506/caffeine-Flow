const db = require('../../db/knex');
const conflict = () => Object.assign(new Error('새 분석 또는 수정이 있습니다. 목록을 새로 불러와주세요.'), { status: 409 });

function baseQuery() {
  return db({ job: 'music_audio_jobs' })
    .leftJoin({ annotation: 'music_track_annotations' }, function () {
      this.on('annotation.platform', 'job.platform').andOn('annotation.track_key', 'job.track_key');
    })
    .leftJoin({ analysis: 'music_audio_analyses' }, 'analysis.id', 'job.analysis_id');
}
function reviewed(query) {
  query.whereNotNull('annotation.id').whereNot('annotation.human_review_status', 'unreviewed')
    .where((q) => q.whereNull('analysis.id').orWhere('analysis.review_status', 'reviewed'));
}
// 사람이 자동 라벨을 보증하지 않은 것들. 라벨은 automatic으로 남아 있어 모델이나
// 택소노미가 바뀌면 재분석·재정규화 대상이 된다.
function rejected(query) {
  query.whereNotNull('annotation.id').whereIn('annotation.human_review_status', ['inaccurate', 'unclear']);
}
function unreviewed(query) {
  query.where((q) => q.whereNull('annotation.id').orWhere('annotation.human_review_status', 'unreviewed')
    .orWhere('analysis.review_status', 'pending'));
}
async function list({ view = 'unreviewed', offset = 0 }) {
  const query = baseQuery();
  if (view === 'reviewed') query.modify(reviewed);
  if (view === 'unreviewed') query.modify(unreviewed);
  if (view === 'ready') query.modify(unreviewed).where('job.status', 'completed').whereNotNull('annotation.id');
  if (view === 'inaccurate') query.modify(rejected);
  const [total, done, rows] = await Promise.all([
    db('music_audio_jobs').count('* as count').first(),
    baseQuery().modify(reviewed).count('* as count').first(),
    query.select('job.id', 'job.platform', 'job.track_key as video_id', 'job.title',
      'job.artist_name as channel_title', 'job.generation', 'job.available_at', 'job.attempts', 'job.status as job_status', 'job.error_code', 'job.created_at',
      db.raw('to_jsonb(annotation) as track_annotation'), db.raw('to_jsonb(analysis) as audio_analysis'))
      .orderBy('job.created_at', 'desc').orderBy('job.id', 'desc').offset(offset).limit(51),
  ]);
  return { decisions: rows.slice(0, 50), offset, has_more: rows.length > 50,
    next_offset: rows.length > 50 ? offset + 50 : null,
    summary: { total: Number(total.count), reviewed: Number(done.count), unreviewed: Number(total.count) - Number(done.count) } };
}

function review(jobId, input, annotation) {
  return db.transaction(async (trx) => {
    const job = await trx('music_audio_jobs').where({ id: jobId }).forUpdate().first();
    if (!job) throw Object.assign(new Error('곡을 찾을 수 없습니다'), { status: 404 });
    if (job.analysis_id !== (input.audio_analysis_id || null)) throw conflict();
    let analysis;
    if (job.analysis_id) {
      analysis = await trx('music_audio_analyses').where({ id: job.analysis_id }).forUpdate().first();
      if (analysis.revision !== input.audio_analysis_revision) throw conflict();
    }
    if (input.verdict !== undefined && !analysis?.maest_summary?.audio_llm?.description?.trim()) {
      throw Object.assign(new Error('판정할 Audio LLM 서술이 없습니다'), { status: 409 });
    }
    const current = await trx('music_track_annotations').where({ platform: job.platform, track_key: job.track_key }).forUpdate().first();
    if ((current?.revision || 0) !== input.annotation_revision) throw conflict();
    if (!annotation && !current) throw Object.assign(new Error('자동 라벨이 아직 없습니다'), { status: 409 });
    const next = annotation || current;
    const fields = ['genre_tags', 'tempo_class', 'rhythmic_character', 'mood_tags', 'vocal_type', 'instrumentation_type', 'track_version'];
    const known = (field) => next[field] && next[field] !== 'unknown' && (!Array.isArray(next[field]) || next[field].length > 0 && !next[field].includes('unknown'));
    const selected = input.reviewed_fields || (annotation
      ? fields.filter((field) => JSON.stringify(next[field]) !== JSON.stringify(current?.[field]))
      : ['genre_tags', 'tempo_class', 'rhythmic_character']);
    const reviewedFields = [...new Set([...(current?.reviewed_fields || []), ...selected])].filter(known);
    const sameArtist = next.artist_name === current?.artist_name;
    const artistConfirmed = input.artist_confirmed ?? (sameArtist && current?.artist_confirmed || false);
    const status = annotation ? 'corrected' : (input.verdict || 'confirmed');
    // 사람이 맞다고 했을 때만 사람 라벨로 승격한다. 틀렸다·애매하다는 판단은 라벨을
    // 보증하지 않으므로 자동 라벨로 남겨야 한다. label_source가 'automatic'이 아니면
    // 재분석과 정규화가 그 곡을 건너뛰어(jobs.js, renormalize.js), 틀렸다고 표시한 곡이
    // 영영 갱신되지 않는다.
    const affirmed = status === 'confirmed' || status === 'corrected';
    const humanEdited = Boolean(annotation || current?.human_edited);
    const row = {
      ...next, platform: job.platform, track_key: job.track_key, title: job.title,
      mood_tags: JSON.stringify(next.mood_tags), genre_tags: JSON.stringify(next.genre_tags),
      artist_confirmed: artistConfirmed,
      human_edited: humanEdited,
      reviewed_fields: JSON.stringify(affirmed ? reviewedFields : humanEdited ? (current?.reviewed_fields || []) : []),
      label_source: affirmed || humanEdited ? 'human' : 'automatic',
      human_review_status: status,
      revision: (current?.revision || 0) + 1, updated_at: trx.fn.now(),
    };
    delete row.id;
    delete row.created_at;
    const [saved] = await trx('music_track_annotations').insert(row)
      .onConflict(['platform', 'track_key']).merge(row).returning('*');
    if (analysis) await trx('music_audio_analyses').where({ id: analysis.id })
      .update({ review_status: 'reviewed', reviewed_at: trx.fn.now(),
        ...(input.verdict !== undefined ? { human_verdict: input.verdict } : {}) });
    return { track_annotation: saved };
  });
}
module.exports = { list, review };
