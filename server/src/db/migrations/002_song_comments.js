/**
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.createTable('song_comments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('video_id', 20).notNullable();
    t.uuid('cafe_id').nullable().references('id').inTable('cafes').onDelete('CASCADE');
    t.string('commenter_name', 50).nullable();
    t.specificType('commenter_ip', 'inet').nullable();
    t.string('body', 200).notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    t.index(['video_id', 'cafe_id']);
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('song_comments');
};
