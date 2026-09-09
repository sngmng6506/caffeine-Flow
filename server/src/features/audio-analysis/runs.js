const db = require('../../db/knex');
const { GENRE_TAGS, MOOD_TAGS, MAX_MOOD_TAGS } = require('../../constants/music-labeling');
const MODEL = 'discogs-maest-30s-pw-519l-2';
// 감정값을 채운 실행은 임베딩·회귀 모델을 함께 기록한다. 순서까지 고정해 원본만 보고
// 어떤 모델이 돌았는지 알 수 있게 한다.
const EMBEDDING_MODEL = 'msd-musicnn-1';
const EMOTION_MODEL = 'deam-msd-musicnn-2';
const MAEST_ONLY_SOURCES = [MODEL];
const EMOTION_SOURCES = [MODEL, EMBEDDING_MODEL, EMOTION_MODEL];
const MODES = ['MAEST_ONLY', 'MAEST_EMOTION', 'FULL'];
const TEXT_MAX = 4000;
const ITEM_MAX = 120;
const LIST_MAX = 12;
const LLM_FIELDS = ['mood', 'instruments', 'vocal', 'structure'];
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const list = (v) => Array.isArray(v) && v.length <= LIST_MAX && v.every((i) => text(i, ITEM_MAX));

// 2단 원본. 자유 서술이라 값을 검사하지 않고 형태와 크기만 본다. 입력 해시가
// 같은 파일을 가리켜야 1단과 2단이 같은 오디오를 들었다고 말할 수 있다.
function validAudioLlm(raw, mode, audioSha256, duration) {
  if (mode !== 'FULL') return raw === null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  if (!text(raw.model_id, 200) || !text(raw.prompt_version, 100)) return false;
  if (raw.input_sha256 !== audioSha256) return false;
  if (!text(raw.description, TEXT_MAX)) return false;
  if (!LLM_FIELDS.every((field) => list(raw[field]))) return false;
  if (!Array.isArray(raw.segments) || raw.segments.length < 1 || raw.segments.length > 8) return false;
  return raw.segments.every((v) => finite(v.start_sec) && finite(v.duration_sec)
    && v.start_sec >= 0 && v.duration_sec > 0 && v.start_sec + v.duration_sec <= duration + 0.001);
}
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const score = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const vector = (v) => Array.isArray(v) && v.length === 519 && v.every(score);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// 감정값은 features와 원본이 같은 값을 가리켜야 한다. 한쪽만 고쳐 보내는 것을 막는다.
function validMood(mood, full, features) {
  if (!full) return mood === null;
  if (!mood || typeof mood !== 'object' || Array.isArray(mood)) return false;
  if (mood.source !== EMOTION_MODEL) return false;
  if (!score(mood.valence) || !score(mood.arousal)) return false;
  if (mood.valence !== features.valence || mood.arousal !== features.arousal) return false;
  if (!Array.isArray(mood.tags) || mood.tags.length > MAX_MOOD_TAGS) return false;
  return new Set(mood.tags).size === mood.tags.length
    && mood.tags.every((v) => MOOD_TAGS.includes(v) && v !== 'unknown');
}

function validateRun(input, result) {
  const invalid = () => ({ error: 'MAEST 원본·입력 정보가 올바르지 않습니다' });
  const mode = input?.pipeline_mode;
  const withEmotion = mode === 'MAEST_EMOTION' || mode === 'FULL';
  const expectedSources = withEmotion ? EMOTION_SOURCES : MAEST_ONLY_SOURCES;
  if (!input || input.schema_version !== 1 || !MODES.includes(mode) ||
      input.maest_model_version !== MODEL || !hash(input.model_sha256) || !hash(input.audio_sha256) ||
      input.audio_local_path !== null ||
      !finite(input.audio_duration_sec) || Math.abs(input.audio_duration_sec - result.features.duration_seconds) > 0.001 || input.audio_sample_rate !== 16000 ||
      input.audio_duration_sec < 10 || input.audio_duration_sec > 900 ||
      input.audio_source_url !== result.source_reference || !Array.isArray(input.sources_used) ||
      input.sources_used.length !== expectedSources.length + (mode === 'FULL' ? 1 : 0) ||
      expectedSources.some((v, i) => input.sources_used[i] !== v) ||
      (mode === 'FULL' && input.sources_used.at(-1) !== input.audio_llm_raw?.model_id) ||
      !validAudioLlm(input.audio_llm_raw, mode, input.audio_sha256, input.audio_duration_sec)) return invalid();
  const raw = input.maest_raw;
  if (!raw || !Array.isArray(raw.classes) || raw.classes.length !== 519 || new Set(raw.classes).size !== 519 ||
      raw.classes.some((v) => typeof v !== 'string' || v.length > 120 || !v.includes('---')) ||
      !vector(raw.mean) || !vector(raw.max) || !Array.isArray(raw.segments) ||
      raw.segments.length < 1 || raw.segments.length > 64 ||
      typeof raw.essentia_version !== 'string' || raw.essentia_version.length > 100) return invalid();
  const settings = raw.settings;
  if (!settings || settings.sample_rate !== 16000 || settings.patch_size !== 1876 || settings.patch_hop_size !== 938 ||
      settings.frame_hop !== 256 || settings.last_patch_mode !== 'repeat' || settings.resample_quality !== 4 ||
      settings.output !== 'PartitionedCall/Identity_13' || settings.batch_size !== 1) return invalid();
  for (const [i, segment] of raw.segments.entries()) {
    if (!finite(segment.start_sec) || !finite(segment.end_sec) ||
        Math.abs(segment.start_sec - i * 938 * 256 / 16000) > 0.001 ||
        segment.end_sec <= segment.start_sec || segment.end_sec > input.audio_duration_sec + 0.001 || !vector(segment.scores)) return invalid();
  }
  if (Math.abs(raw.segments.at(-1).end_sec - input.audio_duration_sec) > 0.1) return invalid();
  for (let i = 0; i < 519; i++) {
    const values = raw.segments.map((v) => v.scores[i]);
    if (Math.abs(raw.mean[i] - values.reduce((a, b) => a + b, 0) / values.length) > 0.000001 ||
        Math.abs(raw.max[i] - Math.max(...values)) > 0.000001) return invalid();
  }
  const normalized = input.normalized;
  if (!normalized || typeof normalized.taxonomy_version !== 'string' || normalized.taxonomy_version.length > 100 ||
      normalized.calibrated !== false || !validMood(normalized.mood, withEmotion, result.features) ||
      !Array.isArray(normalized.genre) || normalized.genre.length > 2 ||
      normalized.genre.some((v) => !GENRE_TAGS.includes(v.label) || v.source !== 'maest' || !score(v.confidence) ||
        !raw.classes.includes(v.raw_label) || Math.abs(raw.mean[raw.classes.indexOf(v.raw_label)] - v.confidence) > 0.000001)) return invalid();
  return { value: {
    schema_version: 1,
    pipeline_mode: input.pipeline_mode,
    // FULL이면 2단 모델까지 저장한다. 검증만 하고 빼면 원본으로 재현할 수 없다.
    sources_used: mode === 'FULL' ? [...expectedSources, input.audio_llm_raw.model_id] : expectedSources,
    maest_model_version: MODEL,
    model_sha256: input.model_sha256, audio_source_url: input.audio_source_url, audio_local_path: null,
    audio_sha256: input.audio_sha256, audio_duration_sec: input.audio_duration_sec, audio_sample_rate: input.audio_sample_rate,
    audio_llm_raw: input.audio_llm_raw, normalized,
    maest_raw: { classes: raw.classes, mean: raw.mean, max: raw.max, settings,
      essentia_version: raw.essentia_version,
      segments: raw.segments.map(({ start_sec, end_sec, scores }) => ({ start_sec, end_sec, scores })) },
  } };
}

function summary(run) {
  const raw = run.maest_raw;
  const top = (key) => raw.classes.map((label, i) => ({ label, mean: raw.mean[i], max: raw.max[i] }))
    .sort((a, b) => b[key] - a[key]).slice(0, 10);
  return { model_version: run.maest_model_version, segment_count: raw.segments.length,
    top_mean: top('mean'), top_max: top('max'), normalized: run.normalized, audio_sha256: run.audio_sha256 };
}

async function history(jobId) {
  const job = await db('music_audio_jobs').where({ id: jobId }).first();
  if (!job) throw Object.assign(new Error('곡을 찾을 수 없습니다'), { status: 404 });
  return db('music_audio_runs').where({ platform: job.platform, track_key: job.track_key })
    .select('id', 'created_at').orderBy('created_at', 'desc').limit(100);
}

module.exports = { validateRun, summary, history };
