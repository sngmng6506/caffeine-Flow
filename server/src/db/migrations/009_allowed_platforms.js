exports.up = async (knex) => {
  await knex.schema.alterTable('cafes', (t) => {
    // 기본값: 3개 플랫폼 모두 허용
    t.text('allowed_platforms').defaultTo('youtube,soundcloud,spotify');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('cafes', (t) => {
    t.dropColumn('allowed_platforms');
  });
};
