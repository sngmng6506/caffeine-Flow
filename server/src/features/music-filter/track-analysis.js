const db = require('../../db/knex');
const { canonicalizeVideoId } = require('../../utils/video-id');

// 분석이 없는 곡이 대부분이다. 조회 한 번이 실시간 신청 경로에 붙으므로 실패해도
// 필터를 멈추지 않는다 — 분석은 판단을 돕는 재료이지 판단의 전제가 아니다.
const LOOKUP_TIMEOUT_MS = 700;

// 서술이 길면 프롬프트를 잡아먹는다. 사람이 읽을 때는 전문이 필요하지만
// 판단에는 앞부분이면 충분하다.
const DESCRIPTION_MAX = 600;

function trim(value, limit) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function list(values, limit = 8) {
  return Array.isArray(values)
    ? values.filter((v) => typeof v === 'string' && v.trim()).slice(0, limit).map((v) => v.trim())
    : [];
}

// 소수 둘째 자리면 충분하다. 보정되지 않은 상대 점수라 정밀도를 늘려봐야 의미가 없다.
const round = (value, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

function shape(row) {
  if (!row) return null;
  const features = row.features || {};
  const summary = row.maest_summary || {};
  const llm = summary.audio_llm || null;
  // MAEST 스타일은 runs.selectPromptStyles가 고른 것을 그대로 쓴다. 소비처가
  // 임계값을 다시 정의하지 않는다 — 점수 스케일이 곡마다 다르다.
  const styles = Array.isArray(summary.prompt_styles)
    ? summary.prompt_styles.filter((v) => v && typeof v.label === 'string')
      .map((v) => ({ label: v.label, score: round(v.score, 3) }))
    : [];
  if (!styles.length && !llm?.description && !Number.isFinite(features.valence)) return null;
  return {
    styles,
    calibrated: summary.prompt_style_calibrated === true,
    valence: round(features.valence),
    arousal: round(features.arousal),
    bpm: round(features.bpm, 1),
    description: llm ? trim(llm.description, DESCRIPTION_MAX) : '',
    mood: list(llm?.mood),
    instruments: list(llm?.instruments),
    vocal: list(llm?.vocal),
    analyzed_at: row.analyzed_at,
  };
}

// 같은 곡의 분석은 (platform, track_key, model_name, model_version) upsert라
// 모델이 바뀌면 여러 줄이 생긴다. 가장 최근에 분석한 것을 쓴다.
async function findForTrack(platform, trackKey) {
  if (!platform || !trackKey) return null;
  // 분석 작업의 track_key는 저장될 때 정규화된 값이다(recommendation.service가
  // canonicalizeVideoId를 거쳐 넣는다). 필터는 신청 URL에서 막 뽑은 원본 ID를
  // 들고 있으므로, 같은 규칙을 적용하지 않으면 항상 못 찾는다.
  const row = await db('music_audio_analyses')
    .where({ platform, track_key: canonicalizeVideoId(trackKey) })
    .orderBy('analyzed_at', 'desc').first()
    // cancel은 취소 질의를 보내려고 커넥션을 하나 더 잡는다. 풀이 붐비면 타임아웃
    // 처리가 도리어 막히므로 쓰지 않는다. 여기서는 요청을 붙잡지 않는 것으로 충분하다.
    .timeout(LOOKUP_TIMEOUT_MS);
  return shape(row);
}

module.exports = { findForTrack, shape, DESCRIPTION_MAX };
