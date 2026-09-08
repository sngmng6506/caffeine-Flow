/**
 * 자동 분석 제출에서 권리 근거·출처 참조를 필수 입력에서 뺀다.
 *
 * 컬럼을 지우지 않고 nullable 레거시로 남긴다. 이미 수집한 행의 값을 잃지 않고,
 * 되돌릴 때도 데이터를 지어내지 않기 위해서다. 런타임 API·워커·라벨링 화면은
 * 이 두 컬럼을 더 이상 읽거나 쓰지 않는다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.raw(`
    ALTER TABLE music_audio_analyses
      DROP CONSTRAINT IF EXISTS music_audio_analyses_rights_check,
      ALTER COLUMN rights_basis DROP NOT NULL,
      ALTER COLUMN source_reference DROP NOT NULL
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  // CHECK는 NULL 행을 통과시키므로 그대로 복구한다.
  await knex.raw(`
    ALTER TABLE music_audio_analyses
      ADD CONSTRAINT music_audio_analyses_rights_check
        CHECK (rights_basis IN ('owned', 'licensed', 'public_domain', 'other_authorized'))
  `);

  // NOT NULL은 값이 비어 있는 행이 하나도 없을 때만 되돌린다. 값을 지어내
  // 채우면 "권리 근거를 확인했다"는 거짓 기록이 남는다.
  const [{ count }] = await knex('music_audio_analyses')
    .whereNull('rights_basis')
    .orWhereNull('source_reference')
    .count({ count: '*' });

  if (Number(count) === 0) {
    await knex.raw(`
      ALTER TABLE music_audio_analyses
        ALTER COLUMN rights_basis SET NOT NULL,
        ALTER COLUMN source_reference SET NOT NULL
    `);
  }
};
