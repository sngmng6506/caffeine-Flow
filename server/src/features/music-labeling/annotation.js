const { validateString } = require('../../utils/validate');
const {
  TEMPO_CLASSES,
  MOOD_TAGS,
  INSTRUMENTATION_TYPES,
  RHYTHMIC_CHARACTERS,
  VOCAL_TYPES,
  GENRE_TAGS,
  TRACK_VERSIONS,
  LABEL_USAGE_SCOPES,
  MUSIC_LABEL_SCHEMA_VERSION,
  MAX_MOOD_TAGS,
  MAX_GENRE_TAGS,
} = require('../../constants/music-labeling');

function normalizeArtistKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+-\s+topic$/i, '')
    .replace(/vevo$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateChoice(value, allowed, name) {
  return allowed.includes(value)
    ? { value }
    : { error: `${name} 선택값이 올바르지 않습니다` };
}

function validateTags(value, allowed, max, name, { required = false } = {}) {
  if (!Array.isArray(value)) return { error: `${name}은 배열이어야 합니다` };
  const unique = [...new Set(value)];
  if (unique.length !== value.length) return { error: `${name}에 중복 선택이 있습니다` };
  if ((required && unique.length < 1) || unique.length > max) {
    return { error: `${name}은 ${required ? '1~' : ''}${max}개까지 선택할 수 있습니다` };
  }
  if (unique.some((item) => !allowed.includes(item))) {
    return { error: `${name} 선택값이 올바르지 않습니다` };
  }
  if (unique.includes('unknown') && unique.length > 1) {
    return { error: `${name}의 판단하기 어려움은 단독으로 선택해야 합니다` };
  }
  return { value: unique };
}

function validateMusicAnnotation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: '곡 특성 라벨이 필요합니다' };
  }

  const artist = validateString(input.artist_name, { max: 200, name: '확인한 아티스트명' });
  if (artist.error) return artist;
  const note = validateString(input.note, { max: 500, allowNull: true, name: '추가 메모' });
  if (note.error) return note;

  const checks = {
    track_version: validateChoice(input.track_version, TRACK_VERSIONS, '곡 버전'),
    tempo_class: validateChoice(input.tempo_class, TEMPO_CLASSES, '체감 템포'),
    mood_tags: validateTags(input.mood_tags, MOOD_TAGS, MAX_MOOD_TAGS, '주요 분위기', { required: true }),
    instrumentation_type: validateChoice(input.instrumentation_type, INSTRUMENTATION_TYPES, '사운드 구성'),
    rhythmic_character: validateChoice(input.rhythmic_character, RHYTHMIC_CHARACTERS, '리듬 특징'),
    vocal_type: validateChoice(input.vocal_type, VOCAL_TYPES, '보컬 유형'),
    genre_tags: validateTags(input.genre_tags || [], GENRE_TAGS, MAX_GENRE_TAGS, '장르'),
    usage_scope: validateChoice(input.usage_scope, LABEL_USAGE_SCOPES, '사용 목적'),
  };
  for (const result of Object.values(checks)) {
    if (result.error) return result;
  }

  const artistKey = normalizeArtistKey(artist.value);
  if (!artistKey) return { error: '확인한 아티스트명이 필요합니다' };

  return {
    value: {
      artist_name: artist.value,
      artist_key: artistKey,
      track_version: checks.track_version.value,
      tempo_class: checks.tempo_class.value,
      mood_tags: checks.mood_tags.value,
      instrumentation_type: checks.instrumentation_type.value,
      rhythmic_character: checks.rhythmic_character.value,
      vocal_type: checks.vocal_type.value,
      genre_tags: checks.genre_tags.value,
      note: note.value,
      usage_scope: checks.usage_scope.value,
      schema_version: MUSIC_LABEL_SCHEMA_VERSION,
    },
  };
}

module.exports = { normalizeArtistKey, validateMusicAnnotation };
