const db = require('../../db/knex');

// 한 줄만 존재한다. 마이그레이션이 기본값 행을 넣지만, 어떤 이유로든 비어 있으면
// 파이프라인이 멈추지 않도록 켜진 것으로 본다 — 분석이 도는 편이 기본값이다.
const DEFAULTS = Object.freeze({ audio_llm_enabled: true });

async function get() {
  const row = await db('audio_pipeline_settings').where({ id: 1 }).first();
  return { audio_llm_enabled: row ? row.audio_llm_enabled : DEFAULTS.audio_llm_enabled };
}

async function update({ audio_llm_enabled: enabled }) {
  await db('audio_pipeline_settings')
    .insert({ id: 1, audio_llm_enabled: enabled, updated_at: db.fn.now() })
    .onConflict('id')
    .merge({ audio_llm_enabled: enabled, updated_at: db.fn.now() });
  return get();
}

module.exports = { get, update, DEFAULTS };
