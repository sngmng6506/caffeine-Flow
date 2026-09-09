const db = require('../../db/knex');
const { AUDIO_REVIEW_STATUS } = require('../../constants/audio-analysis');

function saveResult(result, connection = db) {
  const now = new Date();
  const row = {
    ...result,
    features: JSON.stringify(result.features),
    suggested_annotation: JSON.stringify(result.suggested_annotation),
    review_status: AUDIO_REVIEW_STATUS.PENDING,
    reviewed_at: null,
    automatic_annotation: result.automatic_annotation ? JSON.stringify(result.automatic_annotation) : null,
    tag_scores: JSON.stringify(result.tag_scores || {}),
    maest_summary: result.maest_summary ? JSON.stringify(result.maest_summary) : null,
    latest_run_id: result.latest_run_id || null,
    updated_at: now,
  };
  return connection('music_audio_analyses')
    .insert(row)
    .onConflict(['platform', 'track_key', 'model_name', 'model_version'])
    .merge({
      feature_schema_version: row.feature_schema_version,
      rights_basis: row.rights_basis,
      source_reference: row.source_reference,
      features: row.features,
      suggested_annotation: row.suggested_annotation,
      review_status: row.review_status,
      analyzed_at: row.analyzed_at,
      reviewed_at: row.reviewed_at,
      updated_at: row.updated_at,
      revision: connection.raw('music_audio_analyses.revision + 1'),
      automatic_annotation: row.automatic_annotation,
      tag_scores: row.tag_scores,
      maest_summary: row.maest_summary,
      latest_run_id: row.latest_run_id,
    })
    .returning('*')
    .then(([saved]) => saved);
}

module.exports = { saveResult };
