const db = require('../../db/knex');
const { MOOD_TAGS, MAX_MOOD_TAGS } = require('../../constants/music-labeling');
const contract = require('../../constants/audio-pipeline.json');
// 감정값을 채운 실행은 임베딩·회귀 모델을 함께 기록한다. 순서까지 고정해 원본만 보고
// 어떤 모델이 돌았는지 알 수 있게 한다.
const EMBEDDING_MODEL = contract.emotion_models.embedding;
const EMOTION_MODEL = contract.emotion_models.regression;
// 신청 시점 경로가 도는 단계는 하나다 — Valence/Arousal + Audio LLM. 장르를 판단할
// 모델이 없으므로 분기할 모드도 없다.
const EMOTION_LLM_SOURCES = [EMBEDDING_MODEL, EMOTION_MODEL];
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

// Audio LLM은 서버가 껐거나 워커에 API 키가 없거나 호출에 실패하면 null일 수 있다.
// 결과가 있을 때만 자유 서술의 형태와 입력 오디오 일치를 검증한다.
function validAudioLlm(raw, audioSha256, duration) {
  if (raw === null) return true;
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

// 워커가 재는 두 길이의 허용 오차다. audio_duration_sec은 16kHz wav 헤더에서,
// features.duration_seconds는 Essentia가 44.1kHz로 다시 읽어 계산한다. 리샘플러가
// 꼬리에 몇 샘플을 더하거나 빼므로 밀리초 단위로 어긋나는 것이 정상이다 —
// 실측에서 2.93ms 차이로 정상 결과가 거절됐다. 파일이 바뀐 것을 잡자는 검사이지
// 두 디코더를 같은 샘플로 맞추자는 검사가 아니다. 구간 끝 검사와 같은 값을 쓴다.
const DURATION_TOLERANCE_SEC = 0.1;

// 신청 시점 경로가 만든 실행. 장르를 판단할 모델이 없으므로 genre는 빈 배열이어야
// 한다. `unknown`으로 채우지 않는 것은 "모른다"와 "판단할 모델이 돌지 않았다"가
// 다르기 때문이다 — 소비처는 빈 배열일 때 장르 줄을 렌더하지 않는다.
function validateRun(input, result) {
  const invalid = () => ({ error: '감정·서술 원본이 올바르지 않습니다' });
  if (input?.schema_version !== 1 || input?.pipeline_mode !== 'EMOTION_LLM') return invalid();
  const expected = [...EMOTION_LLM_SOURCES];
  if (input?.audio_llm_raw) expected.push(input.audio_llm_raw.model_id);
  if (!hash(input.audio_sha256) || input.audio_local_path !== null ||
      !finite(input.audio_duration_sec) ||
      Math.abs(input.audio_duration_sec - result.features.duration_seconds) > DURATION_TOLERANCE_SEC ||
      input.audio_sample_rate !== contract.audio.sample_rate ||
      input.audio_duration_sec < contract.audio_duration_sec.min ||
      input.audio_duration_sec > contract.audio_duration_sec.max ||
      input.audio_source_url !== result.source_reference ||
      !Array.isArray(input.sources_used) || input.sources_used.length !== expected.length ||
      expected.some((v, i) => input.sources_used[i] !== v) ||
      !validAudioLlm(input.audio_llm_raw, input.audio_sha256, input.audio_duration_sec)) return invalid();
  const normalized = input.normalized;
  if (!normalized || !Array.isArray(normalized.genre) || normalized.genre.length !== 0 ||
      !validMood(normalized.mood, normalized.mood != null, result.features)) return invalid();
  return { value: {
    schema_version: 1, pipeline_mode: 'EMOTION_LLM', sources_used: expected,
    audio_source_url: input.audio_source_url, audio_local_path: null,
    audio_sha256: input.audio_sha256, audio_duration_sec: input.audio_duration_sec,
    audio_sample_rate: input.audio_sample_rate,
    audio_llm_raw: input.audio_llm_raw, normalized,
  } };
}

function summary(run) {
  return { normalized: run.normalized, audio_sha256: run.audio_sha256,
    // 사람이 검토할 때 읽을 자유 서술. 없으면 null이다.
    audio_llm: run.audio_llm_raw ? {
      model_id: run.audio_llm_raw.model_id,
      description: run.audio_llm_raw.description,
      mood: run.audio_llm_raw.mood, instruments: run.audio_llm_raw.instruments,
      vocal: run.audio_llm_raw.vocal, structure: run.audio_llm_raw.structure,
    } : null };
}

async function history(jobId) {
  const job = await db('music_audio_jobs').where({ id: jobId }).first();
  if (!job) throw Object.assign(new Error('곡을 찾을 수 없습니다'), { status: 404 });
  return db('music_audio_runs').where({ platform: job.platform, track_key: job.track_key })
    .select('id', 'created_at').orderBy('created_at', 'desc').limit(100);
}

module.exports = { validateRun, summary, history };
