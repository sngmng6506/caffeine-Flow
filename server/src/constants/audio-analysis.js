const AUDIO_FEATURE_SCHEMA_VERSION = 1;

const AUDIO_REVIEW_STATUS = Object.freeze({
  PENDING: 'pending',
  REVIEWED: 'reviewed',
});

// 분류 헤드가 채우는 칸. 확률이 붙으므로 신뢰도 집계와 검수 정렬의 대상이다.
// 템포·리듬은 BPM 구간 휴리스틱이라 확률이 없어 여기 넣지 않는다.
const AUDIO_SCORED_FIELDS = Object.freeze([
  'mood_tags', 'instrumentation_type', 'vocal_type', 'genre_tags',
]);

// 워커가 붙이는 검수 신호. 자유 문자열을 받지 않고 이 목록으로 고정한다.
const AUDIO_REVIEW_FLAGS = Object.freeze([
  'conflict:mood',
  'conflict:vocal_genre',
  ...AUDIO_SCORED_FIELDS.map((field) => `low_confidence:${field}`),
  ...AUDIO_SCORED_FIELDS.map((field) => `missing:${field}`),
]);

// 일괄 확정 자격. 클라이언트가 보낸 값이 아니라 서버가 저장된 분석으로 다시 판정한다.
// 이 문턱을 넘고 검수 신호가 하나도 없는 곡만 목록에서 한 번에 확정할 수 있다.
const AUDIO_BULK_CONFIRM_MIN_CONFIDENCE = 0.85;
const AUDIO_BULK_CONFIRM_MAX_ITEMS = 50;

// 곡 라벨 확정 경로. 일괄 확정분은 사실상 모델 출력이라 평가에서 구분해야 한다.
const ANNOTATION_CONFIRMATION = Object.freeze({
  REVIEWED: 'reviewed',
  BULK: 'bulk',
});

module.exports = {
  AUDIO_FEATURE_SCHEMA_VERSION,
  AUDIO_REVIEW_STATUS,
  AUDIO_SCORED_FIELDS,
  AUDIO_REVIEW_FLAGS,
  AUDIO_BULK_CONFIRM_MIN_CONFIDENCE,
  AUDIO_BULK_CONFIRM_MAX_ITEMS,
  ANNOTATION_CONFIRMATION,
};
