const db = require('../../db/knex');
const { AUDIO_REVIEW_STATUS } = require('../../constants/audio-analysis');
const { trackKeyOf } = require('../../utils/track-key');

function saveResult(result, connection = db) {
  const now = new Date();
  const row = {
    ...result,
    features: JSON.stringify(result.features),
    suggested_annotation: JSON.stringify(result.suggested_annotation),
    review_status: AUDIO_REVIEW_STATUS.PENDING,
    reviewed_at: null,
    human_verdict: null,
    automatic_annotation: result.automatic_annotation ? JSON.stringify(result.automatic_annotation) : null,
    tag_scores: JSON.stringify(result.tag_scores || {}),
    analysis_summary: result.analysis_summary ? JSON.stringify(result.analysis_summary) : null,
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
      human_verdict: null,
      updated_at: row.updated_at,
      revision: connection.raw('music_audio_analyses.revision + 1'),
      automatic_annotation: row.automatic_annotation,
      tag_scores: row.tag_scores,
      analysis_summary: row.analysis_summary,
      latest_run_id: row.latest_run_id,
    })
    .returning('*')
    .then(([saved]) => saved);
}

// 한 곡의 최신 분석. 다른 모듈(음악 필터)이 분석을 읽는 유일한 경로다 — 이
// 테이블의 구조와 사람 판정의 의미는 이 모듈만 안다.
//
// - 같은 곡의 분석은 (platform, track_key, model_name, model_version) upsert라 모델이
//   바뀌면 여러 줄이 생긴다. 가장 최근에 분석한 것을 쓴다.
// - track_key는 저장될 때 정규화된 값이다(recommendation.service가
//   trackKeyOf를 거쳐 넣는다). 신청 URL에서 막 뽑은 원본 ID로 찾으면 같은
//   규칙을 적용하지 않는 한 항상 못 찾는다.
// - 사람이 틀림·애매로 판정한 분석은 돌려주지 않는다. 판정은 이 분석의 현재 실행에
//   붙으므로 옛 모델의 분석으로 우회하지도 않는다.
// - timeoutMs는 부르는 쪽의 시간 예산이다. cancel은 취소 질의를 보내려고 커넥션을
//   하나 더 잡아 풀이 붐비면 도리어 막히므로 쓰지 않는다.
async function findLatestForTrack(platform, trackKey, { timeoutMs } = {}) {
  if (!platform || !trackKey) return null;
  let query = db('music_audio_analyses')
    .where({ platform, track_key: trackKeyOf(trackKey) })
    .orderBy('analyzed_at', 'desc')
    .first();
  if (timeoutMs) query = query.timeout(timeoutMs);
  const row = await query;
  if (['inaccurate', 'unclear'].includes(row?.human_verdict)) return null;
  return row || null;
}

module.exports = { saveResult, findLatestForTrack };
