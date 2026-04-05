/**
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('cafes', (t) => {
    t.timestamp('last_login_at', { useTz: true }).nullable();
  });

  await knex.schema.createTable('cafe_visits', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('cafe_id').notNullable().references('id').inTable('cafes').onDelete('CASCADE');
    t.specificType('visitor_ip', 'inet').nullable();
    t.timestamp('visited_at', { useTz: true }).defaultTo(knex.fn.now());

    t.index(['cafe_id', 'visited_at']);
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('cafe_visits');
  await knex.schema.alterTable('cafes', (t) => {
    t.dropColumn('last_login_at');
  });
};
