exports.up = async function (knex) {
  await knex.schema.alterTable('recommendations', (t) => {
    t.string('visitor_id', 36).nullable();
  });
  await knex.schema.alterTable('cafe_visits', (t) => {
    t.string('visitor_id', 36).nullable();
  });
  await knex.schema.alterTable('song_comments', (t) => {
    t.string('visitor_id', 36).nullable();
  });
  await knex.schema.alterTable('votes', (t) => {
    t.string('visitor_id', 36).nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('recommendations', (t) => {
    t.dropColumn('visitor_id');
  });
  await knex.schema.alterTable('cafe_visits', (t) => {
    t.dropColumn('visitor_id');
  });
  await knex.schema.alterTable('song_comments', (t) => {
    t.dropColumn('visitor_id');
  });
  await knex.schema.alterTable('votes', (t) => {
    t.dropColumn('visitor_id');
  });
};
