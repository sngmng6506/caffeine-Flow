exports.up = async (knex) => {
  await knex.schema.alterTable('recommendations', (t) => {
    t.text('video_id').alter();
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('recommendations', (t) => {
    t.string('video_id', 20).alter();
  });
};
