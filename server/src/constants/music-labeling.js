const TEMPO_CLASSES = Object.freeze([
  'very_slow', 'slow', 'moderate', 'fast', 'very_fast', 'unknown',
]);

const MOOD_TAGS = Object.freeze([
  'peaceful', 'joyful', 'tender', 'nostalgic', 'sad',
  'uplifting', 'tense', 'aggressive', 'quirky', 'unknown',
]);

const INSTRUMENTATION_TYPES = Object.freeze([
  'acoustic', 'electronic', 'hybrid', 'unknown',
]);

const RHYTHMIC_CHARACTERS = Object.freeze([
  'minimal', 'steady', 'danceable', 'heavy_beat', 'irregular', 'unknown',
]);

const VOCAL_TYPES = Object.freeze([
  'none', 'singing', 'rap_spoken', 'unknown',
]);

const GENRE_TAGS = Object.freeze([
  'pop', 'ballad', 'hiphop_rap', 'rnb_soul', 'rock_metal',
  'electronic_dance', 'jazz', 'classical', 'acoustic_folk',
  'ambient_lofi', 'ost_instrumental', 'world_latin_reggae', 'other', 'unknown',
]);

const TRACK_VERSIONS = Object.freeze([
  'original', 'live', 'remix', 'cover', 'edited', 'unknown',
]);

const LABEL_USAGE_SCOPES = Object.freeze(['operational', 'evaluation']);

// 자동 분석에 대한 사람 판정. 택소노미를 고르는 대신 서술이 곡과 맞는지만 답한다.
// 고르기 어려운 선택지는 사람이 아무거나 찍게 만들고, 그렇게 만든 골드 라벨은
// 없느니만 못하다.
// 판정은 둘이다. '애매'를 두면 판단을 미루는 칸이 되어 어느 쪽으로도 쓰지 못하는
// 라벨만 쌓인다. 틀렸으면 틀렸다고 표시하고 프롬프트를 고쳐 다시 돌린다.
// 'unclear'는 이미 저장된 옛 판정을 읽기 위해 남겨두며 새로 만들지 않는다.
const REVIEW_VERDICTS = Object.freeze({
  accurate: 'confirmed',    // 서술이 곡과 맞는다
  inaccurate: 'inaccurate', // 틀렸다 — 프롬프트나 매칭을 다시 봐야 한다
});
const MUSIC_LABEL_SCHEMA_VERSION = 1;
const MAX_MOOD_TAGS = 2;
const MAX_GENRE_TAGS = 2;

module.exports = {
  REVIEW_VERDICTS,
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
};
