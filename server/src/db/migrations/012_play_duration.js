exports.up = function (knex) {
  return knex.schema.alterTable('recommendations', (t) => {
    t.timestamp('playing_started_at', { useTz: true }).nullable();
    t.integer('play_duration_seconds').nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('recommendations', (t) => {
    t.dropColumn('playing_started_at');
    t.dropColumn('play_duration_seconds');
  });
};
