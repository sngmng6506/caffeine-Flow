// 분석 결과는 음향 분석 모듈의 데이터다. 테이블을 직접 읽지 않고 그 입구로 받는다 —
// 어떤 분석이 최신이고 어떤 사람 판정을 빼야 하는지는 그 모듈이 안다. 여기서는
// 받은 분석을 프롬프트에 넣을 모양으로 다듬기만 한다.
const audioAnalysis = require('../audio-analysis');

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
  const summary = row.analysis_summary || {};
  const llm = summary.audio_llm || null;
  // 장르를 판단할 모델이 없으므로 장르 후보를 넣지 않는다.
  if (!llm?.description && !Number.isFinite(features.valence)) return null;
  return {
    valence: round(features.valence),
    arousal: round(features.arousal),
    bpm: round(features.bpm, 1),
    description: llm ? trim(llm.description, DESCRIPTION_MAX) : '',
    mood: list(llm?.mood),
    instruments: list(llm?.instruments),
    vocal: list(llm?.vocal),
    // 구간별 서술. 3단이 들은 구간 순서와 같다. 곡 전체를 한 문장으로 뭉갠 서술로는
    // 알 수 없는 것(조용히 시작해 후렴에서 커진다 등)이 매장 적합성 판단에 쓰인다.
    structure: list(llm?.structure),
    analyzed_at: row.analyzed_at,
  };
}

async function findForTrack(platform, trackKey) {
  return shape(await audioAnalysis.findLatestForTrack(platform, trackKey, { timeoutMs: LOOKUP_TIMEOUT_MS }));
}

module.exports = { findForTrack, shape, DESCRIPTION_MAX };
