/**
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('cafes', (t) => {
    t.string('google_id', 100).unique().nullable();
    t.string('naver_id',  100).unique().nullable();
    t.string('password_hash', 255).nullable().alter();
    t.string('owner_email',   255).nullable().alter();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.alterTable('cafes', (t) => {
    t.dropColumn('google_id');
    t.dropColumn('naver_id');
    t.string('password_hash', 255).notNullable().alter();
    t.string('owner_email',   255).notNullable().alter();
  });
};
