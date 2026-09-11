// 검토 큐에서 "서술이 틀렸을 법한 곡"을 위로 올리는 규칙.
//
// 검토는 전부 보는 자리가 아니라 틀린 것을 찾는 자리다. 수집이 큐를 채우는 속도를
// 사람이 따라갈 수 없으므로, 순서가 맞으면 위쪽 몇 건만 듣고 나머지는 넘길 수 있다.
//
// 규칙을 여기 한 번만 적고 정렬용 SQL과 화면 표시용 사유를 모두 여기서 파생한다.
// 두 벌로 적으면 "왜 위로 왔는지"와 실제 순서가 조용히 어긋난다.
//
// MAEST 점수는 쓰지 않는다. `runs.js`의 selectPromptStyles가 밝혔듯 점수 스케일이
// 곡마다 달라서 1위가 0.33인 곡이 0.97인 곡보다 덜 확실하다는 뜻이 아니다. 정렬
// 근거로 써도 같은 이유로 틀린다.

const DESCRIPTION_MIN_LENGTH = 120;

const LLM = `analysis.maest_summary->'audio_llm'`;

// jsonb 배열이 아닐 때 jsonb_array_length는 예외를 낸다. 비어 있는 것과 없는 것을
// 같게 본다.
const emptyArraySql = (path) => `NOT (jsonb_typeof(${path}) = 'array' AND jsonb_array_length(${path}) > 0)`;

const emptyArray = (value) => !Array.isArray(value) || value.length === 0;
const normalize = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const llmOf = (row) => row?.audio_analysis?.maest_summary?.audio_llm || null;

// 가중치는 "이걸 보면 실제로 틀린 경우가 많더라"의 순서다. 아티스트 이름이 다르면
// 다른 곡을 분석했을 수 있어 서술 전체가 무의미해진다 — 다른 신호보다 무겁다.
const RULES = Object.freeze([
  {
    code: 'artist_mismatch',
    weight: 3,
    text: '수집한 이름과 저장된 아티스트가 다릅니다',
    sql: `NULLIF(btrim(job.artist_name), '') IS NOT NULL
      AND NULLIF(btrim(annotation.artist_name), '') IS NOT NULL
      AND lower(btrim(job.artist_name)) <> lower(btrim(annotation.artist_name))`,
    test: (row) => {
      const collected = normalize(row.channel_title);
      const stored = normalize(row.track_annotation?.artist_name);
      return Boolean(collected) && Boolean(stored) && collected !== stored;
    },
  },
  {
    code: 'thin_description',
    weight: 2,
    text: '서술이 짧습니다',
    sql: `COALESCE(length(${LLM}->>'description'), 0) < ${DESCRIPTION_MIN_LENGTH}`,
    test: (row) => (llmOf(row)?.description || '').trim().length < DESCRIPTION_MIN_LENGTH,
  },
  {
    code: 'no_instruments',
    weight: 1,
    text: '악기를 하나도 짚지 못했습니다',
    sql: emptyArraySql(`${LLM}->'instruments'`),
    test: (row) => emptyArray(llmOf(row)?.instruments),
  },
  {
    code: 'no_vocal',
    weight: 1,
    text: '보컬을 짚지 못했습니다',
    sql: emptyArraySql(`${LLM}->'vocal'`),
    test: (row) => emptyArray(llmOf(row)?.vocal),
  },
  {
    code: 'unknown_genre',
    weight: 1,
    text: 'MAEST가 장르를 정하지 못했습니다',
    sql: `annotation.genre_tags @> '["unknown"]'::jsonb`,
    test: (row) => (row.track_annotation?.genre_tags || []).includes('unknown'),
  },
  {
    code: 'retried',
    weight: 1,
    text: '분석을 다시 시도한 곡입니다',
    sql: 'job.attempts > 1',
    test: (row) => Number(row.attempts) > 1,
  },
]);

const SUSPICION_SQL = RULES
  .map((rule) => `(CASE WHEN ${rule.sql} THEN ${rule.weight} ELSE 0 END)`)
  .join(' + ');

// 판정할 서술이 없는 곡은 이 목록에 넣지 않는다. 의심스러운 게 아니라 아직 판정할
// 수 없는 것이고, 섞으면 위쪽이 판정 불가 곡으로 막힌다.
const REVIEWABLE_SQL = `COALESCE(btrim(${LLM}->>'description'), '') <> ''`;

/** 이 곡이 왜 위로 왔는지. 화면이 그대로 보여준다. */
function reasons(row) {
  return RULES.filter((rule) => rule.test(row)).map(({ code, text, weight }) => ({ code, text, weight }));
}

function score(row) {
  return reasons(row).reduce((sum, rule) => sum + rule.weight, 0);
}

module.exports = {
  RULES,
  SUSPICION_SQL,
  REVIEWABLE_SQL,
  DESCRIPTION_MIN_LENGTH,
  reasons,
  score,
};
