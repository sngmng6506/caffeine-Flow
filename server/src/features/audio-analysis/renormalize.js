const { isDeepStrictEqual } = require('node:util');
const db = require('../../db/knex');
const { normalize, genreTags } = require('./normalization');
const { summary } = require('./runs');

// 추론 원본은 그대로 두고 현재 택소노미의 파생 라벨만 다시 만든다.
function apply(jobId, input) {
  return db.transaction(async (trx) => {
    const job = await trx('music_audio_jobs').where({ id: jobId }).forUpdate().first();
    if (!job) throw Object.assign(new Error('곡을 찾을 수 없습니다'), { status: 404 });
    if (job.status !== 'completed' || job.generation !== input.generation || job.analysis_id !== input.analysis_id) {
      throw Object.assign(new Error('작업이 변경되었습니다'), { status: 409 });
    }
    const analysis = await trx('music_audio_analyses').where({ id: job.analysis_id }).forUpdate().first();
    if (!analysis || analysis.revision !== input.analysis_revision) throw Object.assign(new Error('분석이 변경되었습니다'), { status: 409 });
    const run = analysis.latest_run_id && await trx('music_audio_runs').where({ id: analysis.latest_run_id }).first();
    if (!run) throw Object.assign(new Error('재정규화할 원본이 없습니다'), { status: 400 });
    const normalized = { ...normalize(run.payload.maest_raw), mood: run.payload.normalized.mood };
    if (isDeepStrictEqual(analysis.maest_summary?.normalized, normalized)) return { id: analysis.id, unchanged: true };
    const annotation = { ...analysis.automatic_annotation, genre_tags: genreTags(normalized) };
    await trx('music_audio_analyses').where({ id: analysis.id }).update({
      automatic_annotation: JSON.stringify(annotation), maest_summary: JSON.stringify(summary({ ...run.payload, normalized })),
      review_status: 'pending', reviewed_at: null, revision: analysis.revision + 1, updated_at: trx.fn.now(),
    });
    await trx('music_track_annotations').where({ platform: job.platform, track_key: job.track_key, label_source: 'automatic' })
      .update({ genre_tags: JSON.stringify(annotation.genre_tags), revision: trx.raw('revision + 1'),
        human_review_status: 'unreviewed', updated_at: trx.fn.now() });
    return { id: analysis.id, revision: analysis.revision + 1, normalized };
  });
}
module.exports = { apply };
