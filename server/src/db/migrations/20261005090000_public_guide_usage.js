exports.up = async function (knex) {
  await knex.schema.createTable('public_guide_usage', table => {
    // global 한 행 + 카페별 한 행. 날짜가 바뀌면 같은 행의 카운터를 재사용한다.
    table.string('scope', 64).primary();
    table.date('usage_date').notNullable();
    table.integer('attempts').notNullable().defaultTo(0);
    table.uuid('lease_token').nullable();
    table.timestamp('lease_until', { useTz: true }).nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('public_guide_usage');
};
