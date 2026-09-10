const crypto = require('node:crypto');
const db = require('../../db/knex');

// 한 줄만 존재한다. 마이그레이션이 기본값 행을 넣지만, 어떤 이유로든 비어 있으면
// 파이프라인이 멈추지 않도록 켜진 것으로 본다 — 분석이 도는 편이 기본값이다.
const DEFAULTS = Object.freeze({ audio_llm_enabled: true, audio_llm_prompt: null });

// 워커가 들고 있는 j2 템플릿을 쓴다는 뜻이다. 워커의 audio_llm.PROMPT_VERSION과 같다.
const BUILTIN_PROMPT_VERSION = 'audio-llm-1';
const PROMPT_MAX = 4000;

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// 프롬프트 본문 자체는 실행 결과(audio_llm_raw)에 넣지 않는다. 대신 이 버전
// 문자열로 이력을 되짚는다.
const promptVersion = (prompt) => (prompt ? `custom-${sha256(prompt).slice(0, 12)}` : BUILTIN_PROMPT_VERSION);

function normalize(row) {
  const prompt = row?.audio_llm_prompt || null;
  return {
    audio_llm_enabled: row ? row.audio_llm_enabled : DEFAULTS.audio_llm_enabled,
    audio_llm_prompt: prompt,
    audio_llm_prompt_version: promptVersion(prompt),
  };
}

async function get() {
  return normalize(await db('audio_pipeline_settings').where({ id: 1 }).first());
}

function validate(input) {
  if (typeof input.audio_llm_enabled !== 'boolean') {
    return { error: 'audio_llm_enabled는 true 또는 false여야 합니다' };
  }
  const raw = input.audio_llm_prompt;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    return { error: '프롬프트는 문자열이어야 합니다' };
  }
  const prompt = typeof raw === 'string' ? raw.trim() : null;
  // 빈 문자열은 "기본 템플릿으로 되돌린다"는 뜻이다.
  if (prompt && prompt.length > PROMPT_MAX) {
    return { error: `프롬프트는 ${PROMPT_MAX}자를 넘을 수 없습니다` };
  }
  return { value: { audio_llm_enabled: input.audio_llm_enabled, audio_llm_prompt: prompt || null } };
}

async function update(input) {
  const checked = validate(input);
  if (checked.error) return checked;
  const { audio_llm_enabled: enabled, audio_llm_prompt: prompt } = checked.value;
  return db.transaction(async (trx) => {
    // 고친 문장을 이력에 남긴다. 같은 내용을 다시 저장하면 한 줄만 유지한다.
    if (prompt) {
      await trx('audio_prompt_revisions').insert({ sha256: sha256(prompt), body: prompt })
        .onConflict('sha256').ignore();
    }
    const row = { id: 1, audio_llm_enabled: enabled, audio_llm_prompt: prompt, updated_at: trx.fn.now() };
    await trx('audio_pipeline_settings').insert(row).onConflict('id')
      .merge({ audio_llm_enabled: enabled, audio_llm_prompt: prompt, updated_at: trx.fn.now() });
    return { value: normalize(await trx('audio_pipeline_settings').where({ id: 1 }).first()) };
  });
}

// 프롬프트를 고친 뒤 옛 서술이 어떤 문장으로 만들어졌는지 되짚을 때 쓴다.
function revisions(limit = 20) {
  return db('audio_prompt_revisions').orderBy('created_at', 'desc').limit(limit);
}

module.exports = { get, update, revisions, validate, promptVersion, DEFAULTS, BUILTIN_PROMPT_VERSION, PROMPT_MAX };
