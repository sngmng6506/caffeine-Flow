/**
 * AI 판단 당시 매장 프롬프트와 설정 변경 이력을 보존한다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('recommendations', (table) => {
    table.text('filter_prompt_snapshot').nullable();
  });
  // 감사 조회용 인덱스는 쓰기가 잦은 recommendations를 잠그지 않도록
  // 20260816090000 마이그레이션에서 CONCURRENTLY로 별도 생성한다.

  await knex.schema.createTable('music_filter_prompt_history', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('cafe_id').notNullable().references('id').inTable('cafes').onDelete('CASCADE');
    table.boolean('enabled').notNullable();
    table.text('prompt').nullable();
    table.string('record_type', 20).notNullable().defaultTo('changed');
    table.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['cafe_id', 'recorded_at'], 'idx_music_filter_prompt_history_cafe_time');
  });

  // 배포 전 설정의 실제 변경 시각은 알 수 없다. 현재 상태만 baseline으로
  // 기록해 이후 변경 이력과 구분하고, 과거 판단 프롬프트는 소급 추정하지 않는다.
  await knex.raw(`
    INSERT INTO music_filter_prompt_history (cafe_id, enabled, prompt, record_type)
    SELECT id, music_filter_enabled, music_filter_prompt, 'baseline'
    FROM cafes
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('music_filter_prompt_history');
  await knex.schema.alterTable('recommendations', (table) => {
    table.dropColumn('filter_prompt_snapshot');
  });
};
