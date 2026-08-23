/**
 * AI 판단과 독립된 운영자 골드 라벨을 추천곡별로 한 건 보존한다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.createTable('music_filter_reviews', (table) => {
    table.uuid('recommendation_id')
      .primary()
      .references('id')
      .inTable('recommendations')
      .onDelete('CASCADE');
    table.string('human_decision', 10).notNullable();
    table.string('human_reason_code', 40).notNullable();
    table.boolean('metadata_sufficient').notNullable();
    table.timestamp('reviewed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE music_filter_reviews
      ADD CONSTRAINT music_filter_reviews_decision_check
        CHECK (human_decision IN ('accept', 'reject')),
      ADD CONSTRAINT music_filter_reviews_reason_check
        CHECK (human_reason_code IN (
          'policy_match',
          'policy_mismatch',
          'unsafe_content',
          'metadata_insufficient',
          'other'
        ))
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('music_filter_reviews');
};
