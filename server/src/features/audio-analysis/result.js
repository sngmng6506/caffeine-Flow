const { VALID_PLATFORMS } = require('../../constants/platforms');
const {
  TEMPO_CLASSES,
  MOOD_TAGS,
  RHYTHMIC_CHARACTERS,
  MAX_MOOD_TAGS,
} = require('../../constants/music-labeling');
const { AUDIO_FEATURE_SCHEMA_VERSION } = require('../../constants/audio-analysis');
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

function validateMoodTags(value) {
  if (value === null || value === undefined) return { value: [] };
  if (!Array.isArray(value)) return { error: '자동 분위기 추천은 배열이어야 합니다' };
  const unique = [...new Set(value)];
  if (unique.length !== value.length || unique.length > MAX_MOOD_TAGS) {
    return { error: `자동 분위기 추천은 중복 없이 ${MAX_MOOD_TAGS}개까지 허용됩니다` };
  }
  if (unique.some((tag) => !MOOD_TAGS.includes(tag)) || unique.includes('unknown')) {
    return { error: '자동 분위기 추천값이 올바르지 않습니다' };
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
  const tempo = validateOptionalChoice(input.tempo_class, TEMPO_CLASSES, '자동 템포 추천');
  if (tempo.error) return tempo;
  const rhythm = validateOptionalChoice(
    input.rhythmic_character,
    RHYTHMIC_CHARACTERS,
    '자동 리듬 추천',
  );
  if (rhythm.error) return rhythm;
  const moods = validateMoodTags(input.mood_tags);
  if (moods.error) return moods;
  return {
    value: {
      ...(tempo.value ? { tempo_class: tempo.value } : {}),
      ...(rhythm.value ? { rhythmic_character: rhythm.value } : {}),
      mood_tags: moods.value,
    },
  };
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
