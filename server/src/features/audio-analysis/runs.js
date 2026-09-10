const db = require('../../db/knex');
const { GENRE_TAGS, MOOD_TAGS, MAX_MOOD_TAGS } = require('../../constants/music-labeling');
const contract = require('../../constants/audio-pipeline.json');
const { classes } = require('../../constants/maest-metadata.json');
const { normalize } = require('./normalization');
const MODEL = contract.model_version;
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

// 토큰 사용량은 선택 항목이다. 프로바이더가 안 주면 없이 저장한다.
function validUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return false;
  const keys = Object.keys(usage);
  return keys.length > 0 && keys.length <= 3
    && keys.every((k) => ['prompt_tokens', 'completion_tokens', 'total_tokens'].includes(k)
      && Number.isSafeInteger(usage[k]) && usage[k] >= 0);
}

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
  if (raw.generation_id !== undefined && !text(raw.generation_id, 200)) return false;
  if (raw.usage !== undefined && !validUsage(raw.usage)) return false;
  return raw.segments.every((v) => finite(v.start_sec) && finite(v.duration_sec)
    && v.start_sec >= 0 && v.duration_sec > 0 && v.start_sec + v.duration_sec <= duration + 0.001);
}
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const score = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const vector = (v) => Array.isArray(v) && v.length === classes.length && v.every(score);
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
  if (result.model_name !== 'essentia-maest' || !result.model_version.split('+').includes(MODEL)) return invalid();
  const mode = input?.pipeline_mode;
  const withEmotion = mode === 'MAEST_EMOTION' || mode === 'FULL';
  const expectedSources = withEmotion ? EMOTION_SOURCES : MAEST_ONLY_SOURCES;
  if (!input || input.schema_version !== 1 || !MODES.includes(mode) ||
      input.maest_model_version !== MODEL || input.model_sha256 !== contract.model_sha256 || !hash(input.audio_sha256) ||
      input.audio_local_path !== null ||
      !finite(input.audio_duration_sec) || Math.abs(input.audio_duration_sec - result.features.duration_seconds) > 0.001 || input.audio_sample_rate !== 16000 ||
      input.audio_duration_sec < 10 || input.audio_duration_sec > 900 ||
      input.audio_source_url !== result.source_reference || !Array.isArray(input.sources_used) ||
      input.sources_used.length !== expectedSources.length + (mode === 'FULL' ? 1 : 0) ||
      expectedSources.some((v, i) => input.sources_used[i] !== v) ||
      (mode === 'FULL' && input.sources_used.at(-1) !== input.audio_llm_raw?.model_id) ||
      !validAudioLlm(input.audio_llm_raw, mode, input.audio_sha256, input.audio_duration_sec)) return invalid();
  const raw = input.maest_raw;
  if (!raw || !Array.isArray(raw.classes) || raw.classes.length !== classes.length || new Set(raw.classes).size !== classes.length ||
      raw.classes.some((v, i) => v !== classes[i]) ||
      !vector(raw.mean) || !vector(raw.max) || !Array.isArray(raw.segments) ||
      raw.segments.length < 1 || raw.segments.length > contract.max_segments ||
      typeof raw.essentia_version !== 'string' || raw.essentia_version.length > 100) return invalid();
  const settings = raw.settings;
  if (!settings || Object.entries(contract.settings).some(([k, v]) => settings[k] !== v)) return invalid();
  const hop = settings.patch_hop_size * settings.frame_hop / settings.sample_rate;
  const duration = settings.patch_size * settings.frame_hop / settings.sample_rate;
  for (const [i, segment] of raw.segments.entries()) {
    if (!segment || !finite(segment.start_sec) || !finite(segment.end_sec) ||
        Math.abs(segment.start_sec - i * hop) > 0.001 ||
        Math.abs(segment.end_sec - Math.min(input.audio_duration_sec, i * hop + duration)) > 0.001 || segment.end_sec <= segment.start_sec || segment.end_sec > input.audio_duration_sec + 0.001 || !vector(segment.scores)) return invalid();
  }
  if (Math.abs(raw.segments.at(-1).end_sec - input.audio_duration_sec) > 0.1) return invalid();
  for (let i = 0; i < classes.length; i++) {
    const values = raw.segments.map((v) => v.scores[i]);
    if (Math.abs(raw.mean[i] - values.reduce((a, b) => a + b, 0) / values.length) > 0.000001 ||
        Math.abs(raw.max[i] - Math.max(...values)) > 0.000001) return invalid();
  }
  const normalized = input.normalized;
  if (!normalized || typeof normalized.taxonomy_version !== 'string' || normalized.taxonomy_version.length > 100 ||
      typeof normalized.calibrated !== 'boolean' || !validMood(normalized.mood, withEmotion, result.features) ||
      !Array.isArray(normalized.genre) || normalized.genre.length > 2 ||
      normalized.genre.some((v) => !v || !GENRE_TAGS.includes(v.label) || v.source !== 'maest' || !score(v.confidence) ||
        !raw.classes.includes(v.raw_label) || Math.abs(raw.mean[raw.classes.indexOf(v.raw_label)] - v.confidence) > 0.000001)) return invalid();
  const canonical = normalize(raw);
  if (normalized.taxonomy_version !== canonical.taxonomy_version || normalized.calibrated !== canonical.calibrated ||
      normalized.genre.length !== canonical.genre.length || normalized.genre.some((v, i) => {
        const expected = canonical.genre[i];
        return v.label !== expected.label || v.raw_label !== expected.raw_label || Math.abs(v.confidence - expected.confidence) > 0.000001;
      })) return invalid();
  return { value: {
    schema_version: 1,
    pipeline_mode: input.pipeline_mode,
    // FULL이면 2단 모델까지 저장한다. 검증만 하고 빼면 원본으로 재현할 수 없다.
    sources_used: mode === 'FULL' ? [...expectedSources, input.audio_llm_raw.model_id] : expectedSources,
    maest_model_version: MODEL,
    model_sha256: input.model_sha256, audio_source_url: input.audio_source_url, audio_local_path: null,
    audio_sha256: input.audio_sha256, audio_duration_sec: input.audio_duration_sec, audio_sample_rate: input.audio_sample_rate,
    audio_llm_raw: input.audio_llm_raw, normalized: { ...canonical, mood: normalized.mood },
    maest_raw: { classes: raw.classes, mean: raw.mean, max: raw.max, settings: contract.settings,
      essentia_version: raw.essentia_version,
      segments: raw.segments.map(({ start_sec, end_sec, scores }) => ({ start_sec, end_sec, scores })) },
  } };
}

// 소비 프롬프트에 넣을 스타일만 추린다. 점수 스케일이 곡마다 달라 절대 임계값을
// 쓰지 않는다 — 1위가 0.33인 곡이 0.97인 곡보다 덜 확실하다는 뜻이 아니다.
// 계수와 상한은 잠정값이며, 519개 원본이 남아 있어 언제든 다시 뽑을 수 있다.
const PROMPT_STYLE_RATIO = 0.5;
const PROMPT_STYLE_MAX = 5;

function selectPromptStyles(raw, ratio = PROMPT_STYLE_RATIO, cap = PROMPT_STYLE_MAX) {
  const scored = raw.classes.map((label, i) => ({ label, score: raw.mean[i] }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  if (!(best > 0)) return [];
  return scored.filter((v) => v.score >= best * ratio).slice(0, cap);
}

function summary(run) {
  const raw = run.maest_raw;
  const top = (key) => raw.classes.map((label, i) => ({ label, mean: raw.mean[i], max: raw.max[i] }))
    .sort((a, b) => b[key] - a[key]).slice(0, 10);
  return { model_version: run.maest_model_version, segment_count: raw.segments.length,
    top_mean: top('mean'), top_max: top('max'), normalized: run.normalized, audio_sha256: run.audio_sha256,
    // 보정되지 않은 상대 점수다. 소비처는 이 사실을 프롬프트에 함께 밝힌다.
    prompt_styles: selectPromptStyles(raw), prompt_style_calibrated: false };
}

async function history(jobId) {
  const job = await db('music_audio_jobs').where({ id: jobId }).first();
  if (!job) throw Object.assign(new Error('곡을 찾을 수 없습니다'), { status: 404 });
  return db('music_audio_runs').where({ platform: job.platform, track_key: job.track_key })
    .select('id', 'created_at').orderBy('created_at', 'desc').limit(100);
}

module.exports = { validateRun, summary, history, selectPromptStyles };
