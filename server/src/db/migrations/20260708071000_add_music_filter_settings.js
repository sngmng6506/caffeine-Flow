exports.up = async function up(knex) {
  const hasMusicFilterEnabled = await knex.schema.hasColumn('cafes', 'music_filter_enabled');
  const hasFilterStatus = await knex.schema.hasColumn('recommendations', 'filter_status');

  if (!hasMusicFilterEnabled) {
    await knex.schema.alterTable('cafes', (table) => {
      table.boolean('music_filter_enabled').notNullable().defaultTo(false);
      table.text('music_filter_prompt');
      table.string('music_filter_strictness', 20).notNullable().defaultTo('medium');
    });
  }

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
};

exports.down = async function down(knex) {
  const hasMusicFilterEnabled = await knex.schema.hasColumn('cafes', 'music_filter_enabled');
  const hasFilterStatus = await knex.schema.hasColumn('recommendations', 'filter_status');

  if (hasFilterStatus) {
    await knex.schema.alterTable('recommendations', (table) => {
      table.dropColumn('filter_checked_at');
      table.dropColumn('filter_error_code');
      table.dropColumn('filter_model');
      table.dropColumn('filter_confidence');
      table.dropColumn('filter_reason');
      table.dropColumn('filter_status');
    });
  }

  if (hasMusicFilterEnabled) {
    await knex.schema.alterTable('cafes', (table) => {
      table.dropColumn('music_filter_strictness');
      table.dropColumn('music_filter_prompt');
      table.dropColumn('music_filter_enabled');
    });
  }
};
