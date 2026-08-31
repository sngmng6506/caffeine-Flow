/**
 * 라벨링 화면에서 더 이상 묻지 않는 메타데이터 충분성을 미확인(null)로 보존한다.
 * 기존 boolean 값은 그대로 유지한다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.raw(`
    ALTER TABLE music_filter_reviews
      ALTER COLUMN metadata_sufficient DROP NOT NULL
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex('music_filter_reviews')
    .whereNull('metadata_sufficient')
    .update({ metadata_sufficient: false });
  await knex.raw(`
    ALTER TABLE music_filter_reviews
      ALTER COLUMN metadata_sufficient SET NOT NULL
  `);
};
