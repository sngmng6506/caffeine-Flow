const { VALID_PLATFORMS } = require('../../constants/platforms');
const {
  TEMPO_CLASSES,
  MOOD_TAGS,
  RHYTHMIC_CHARACTERS,
  INSTRUMENTATION_TYPES,
  VOCAL_TYPES,
  GENRE_TAGS,
  MAX_MOOD_TAGS,
  MAX_GENRE_TAGS,
} = require('../../constants/music-labeling');
const {
  AUDIO_FEATURE_SCHEMA_VERSION,
  AUDIO_SCORED_FIELDS,
  AUDIO_REVIEW_FLAGS,
} = require('../../constants/audio-analysis');
const { validateString } = require('../../utils/validate');

const FEATURE_RANGES = Object.freeze({
  duration_seconds: [0.1, 14400],
  sample_rate: [8000, 192000],
  bpm: [0, 300],
  beat_confidence: [0, 10],
  key_strength: [0, 1],
  danceability: [0, 10],
  loudness_db: [-120, 20],
  dynamic_complexity: [0, 100],
  spectral_centroid_hz: [0, 96000],
  energy: [0, 1],
  valence: [0, 1],
  arousal: [0, 1],
});

function validateNumber(value, range, name, { integer = false, nullable = true } = {}) {
  if (value === null || value === undefined) {
    return nullable ? { value: null } : { error: `${name} 값이 필요합니다` };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    return { error: `${name} 값이 올바르지 않습니다` };
  }
  if (value < range[0] || value > range[1]) {
    return { error: `${name} 값이 허용 범위를 벗어났습니다` };
  }
  return { value };
}

function validateOptionalChoice(value, allowed, name) {
  if (value === null || value === undefined) return { value: null };
  return allowed.includes(value)
    ? { value }
    : { error: `${name} 선택값이 올바르지 않습니다` };
}

// 자동 추천에서 `unknown`은 받지 않는다. "모르겠다"는 사람이 고르는 값이고,
// 모델이 확신하지 못했다면 애초에 칸을 비워야 한다.
function validateTagList(value, allowed, max, name) {
  if (value === null || value === undefined) return { value: [] };
  if (!Array.isArray(value)) return { error: `${name}은 배열이어야 합니다` };
  const unique = [...new Set(value)];
  if (unique.length !== value.length || unique.length > max) {
    return { error: `${name}은 중복 없이 ${max}개까지 허용됩니다` };
  }
  if (unique.some((tag) => !allowed.includes(tag)) || unique.includes('unknown')) {
    return { error: `${name} 값이 올바르지 않습니다` };
  }
  return { value: unique };
}

// 신뢰도는 확률이 붙는 칸만 가진다. 휴리스틱 칸에 점수가 오면 정렬이 거짓말을
// 하게 되므로 거절한다.
function validateConfidence(input) {
  if (input === null || input === undefined) return { value: null };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { error: '신뢰도는 객체여야 합니다' };
  }
  const value = {};
  for (const [field, score] of Object.entries(input)) {
    if (!AUDIO_SCORED_FIELDS.includes(field)) {
      return { error: `신뢰도를 가질 수 없는 항목입니다: ${field}` };
    }
    const result = validateNumber(score, [0, 1], `${field} 신뢰도`, { nullable: false });
    if (result.error) return result;
    value[field] = result.value;
  }
  return { value: Object.keys(value).length ? value : null };
}

function validateReviewFlags(input) {
  if (input === null || input === undefined) return { value: [] };
  if (!Array.isArray(input)) return { error: '검수 신호는 배열이어야 합니다' };
  const unique = [...new Set(input)];
  if (unique.length > AUDIO_REVIEW_FLAGS.length) {
    return { error: '검수 신호가 너무 많습니다' };
  }
  if (unique.some((flag) => !AUDIO_REVIEW_FLAGS.includes(flag))) {
    return { error: '검수 신호 값이 올바르지 않습니다' };
  }
  return { value: unique };
}

function validateFeatures(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'features 객체가 필요합니다' };
  }
  const value = {};
  for (const [key, range] of Object.entries(FEATURE_RANGES)) {
    const result = validateNumber(input[key], range, key, {
      integer: key === 'sample_rate',
      nullable: !['duration_seconds', 'sample_rate'].includes(key),
    });
    if (result.error) return result;
    value[key] = result.value;
  }

  const musicalKey = validateString(input.key, { max: 10, allowNull: true, name: '조성' });
  if (musicalKey.error) return musicalKey;
  const scale = validateOptionalChoice(input.scale, ['major', 'minor'], '장·단조');
  if (scale.error) return scale;
  value.key = musicalKey.value;
  value.scale = scale.value;
  return { value };
}

function validateSuggestion(input) {
  if (input === null || input === undefined) return { value: {} };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'suggested_annotation 객체가 필요합니다' };
  }

  const choices = {
    tempo_class: validateOptionalChoice(input.tempo_class, TEMPO_CLASSES, '자동 템포 추천'),
    rhythmic_character: validateOptionalChoice(
      input.rhythmic_character, RHYTHMIC_CHARACTERS, '자동 리듬 추천',
    ),
    instrumentation_type: validateOptionalChoice(
      input.instrumentation_type, INSTRUMENTATION_TYPES, '자동 사운드 구성 추천',
    ),
    vocal_type: validateOptionalChoice(input.vocal_type, VOCAL_TYPES, '자동 보컬 추천'),
  };
  for (const result of Object.values(choices)) {
    if (result.error) return result;
  }

  const moods = validateTagList(input.mood_tags, MOOD_TAGS, MAX_MOOD_TAGS, '자동 분위기 추천');
  if (moods.error) return moods;
  const genres = validateTagList(input.genre_tags, GENRE_TAGS, MAX_GENRE_TAGS, '자동 장르 추천');
  if (genres.error) return genres;

  const confidence = validateConfidence(input.confidence);
  if (confidence.error) return confidence;
  const minConfidence = validateNumber(input.min_confidence, [0, 1], '최저 신뢰도');
  if (minConfidence.error) return minConfidence;
  const flags = validateReviewFlags(input.review_flags);
  if (flags.error) return flags;

  const value = { mood_tags: moods.value };
  for (const [field, result] of Object.entries(choices)) {
    if (result.value) value[field] = result.value;
  }
  if (genres.value.length) value.genre_tags = genres.value;
  if (confidence.value) value.confidence = confidence.value;
  if (minConfidence.value !== null) value.min_confidence = minConfidence.value;
  if (flags.value.length) value.review_flags = flags.value;
  return { value };
}

function validateAudioAnalysisResult(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: '오디오 분석 결과가 필요합니다' };
  }

  const platform = validateOptionalChoice(input.platform, VALID_PLATFORMS, '플랫폼');
  if (platform.error || !platform.value) return { error: platform.error || '플랫폼이 필요합니다' };
  const strings = {
    track_key: validateString(input.track_key, { max: 2000, name: '곡 식별자' }),
    model_name: validateString(input.model_name, { max: 100, name: '분석 모델명' }),
    model_version: validateString(input.model_version, { max: 100, name: '분석 모델 버전' }),
  };
  for (const result of Object.values(strings)) {
    if (result.error) return result;
  }
  if (input.feature_schema_version !== AUDIO_FEATURE_SCHEMA_VERSION) {
    return { error: `feature_schema_version은 ${AUDIO_FEATURE_SCHEMA_VERSION}이어야 합니다` };
  }
  const analyzedAt = new Date(input.analyzed_at);
  if (!input.analyzed_at || Number.isNaN(analyzedAt.getTime())) {
    return { error: '분석 시각이 올바르지 않습니다' };
  }
  const features = validateFeatures(input.features);
  if (features.error) return features;
  const suggestion = validateSuggestion(input.suggested_annotation);
  if (suggestion.error) return suggestion;

  return {
    value: {
      platform: platform.value,
      track_key: strings.track_key.value,
      model_name: strings.model_name.value,
      model_version: strings.model_version.value,
      feature_schema_version: AUDIO_FEATURE_SCHEMA_VERSION,
      features: features.value,
      suggested_annotation: suggestion.value,
      analyzed_at: analyzedAt,
    },
  };
}

module.exports = { validateAudioAnalysisResult };
