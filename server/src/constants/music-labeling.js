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
const MUSIC_LABEL_SCHEMA_VERSION = 1;
const MAX_MOOD_TAGS = 2;
const MAX_GENRE_TAGS = 2;

module.exports = {
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
