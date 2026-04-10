/**
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('recommendations', (t) => {
    t.string('platform', 20).notNullable().defaultTo('youtube');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.alterTable('recommendations', (t) => {
    t.dropColumn('platform');
  });
};
