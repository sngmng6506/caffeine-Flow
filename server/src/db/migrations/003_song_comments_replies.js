/**
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('song_comments', (t) => {
    t.uuid('parent_id').nullable().references('id').inTable('song_comments').onDelete('CASCADE');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.alterTable('song_comments', (t) => {
    t.dropColumn('parent_id');
  });
};
