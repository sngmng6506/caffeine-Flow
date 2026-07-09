async function ensureMusicFilterColumns(knex) {
  const hasCafes = await knex.schema.hasTable('cafes');
  const hasRecommendations = await knex.schema.hasTable('recommendations');

  if (hasCafes) {
    const hasMusicFilterEnabled = await knex.schema.hasColumn('cafes', 'music_filter_enabled');
    if (!hasMusicFilterEnabled) {
      await knex.schema.alterTable('cafes', (table) => {
        table.boolean('music_filter_enabled').notNullable().defaultTo(false);
        table.text('music_filter_prompt');
        table.string('music_filter_strictness', 20).notNullable().defaultTo('medium');
      });
    }
  }

  if (hasRecommendations) {
    const hasFilterStatus = await knex.schema.hasColumn('recommendations', 'filter_status');
    if (!hasFilterStatus) {
      await knex.schema.alterTable('recommendations', (table) => {
        table.string('filter_status', 30).notNullable().defaultTo('skipped');
        table.text('filter_reason');
        table.decimal('filter_confidence', 4, 3);
        table.string('filter_model', 100);
        table.string('filter_error_code', 80);
        table.timestamp('filter_checked_at');
      });
    }
  }
}

exports.up = ensureMusicFilterColumns;

exports.down = async function down() {
  // 이 마이그레이션은 fresh DB에서 기존 파일명 순서 이슈를 보정하는 안전장치다.
  // 실제 컬럼 제거는 20260708071000_add_music_filter_settings.js down이 담당한다.
};
