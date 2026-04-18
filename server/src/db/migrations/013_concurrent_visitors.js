exports.up = function (knex) {
  return knex.schema.alterTable('daily_stats', (t) => {
    t.integer('peak_concurrent').defaultTo(0);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('daily_stats', (t) => {
    t.dropColumn('peak_concurrent');
  });
};
