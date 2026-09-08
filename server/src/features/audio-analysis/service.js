const db = require('../../db/knex');
const { AUDIO_REVIEW_STATUS } = require('../../constants/audio-analysis');

function saveResult(result) {
  const now = new Date();
  const row = {
    ...result,
    features: JSON.stringify(result.features),
    suggested_annotation: JSON.stringify(result.suggested_annotation),
    review_status: AUDIO_REVIEW_STATUS.PENDING,
    reviewed_at: null,
    updated_at: now,
  };
  return db('music_audio_analyses')
    .insert(row)
    .onConflict(['platform', 'track_key', 'model_name', 'model_version'])
    .merge({
      feature_schema_version: row.feature_schema_version,
      features: row.features,
      suggested_annotation: row.suggested_annotation,
      review_status: row.review_status,
      analyzed_at: row.analyzed_at,
      reviewed_at: row.reviewed_at,
      updated_at: row.updated_at,
    })
    .returning('*')
    .then(([saved]) => saved);
}

module.exports = { saveResult };
