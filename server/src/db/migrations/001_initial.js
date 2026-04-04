/**
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.createTable('cafes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 100).notNullable();
    t.string('slug', 60).unique().notNullable();
    t.string('owner_email', 255).notNullable();
    t.string('password_hash', 255).notNullable();
    t.boolean('is_accepting').defaultTo(true);
    t.uuid('now_playing_id').nullable();
    t.timestamp('disclaimer_accepted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('recommendations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('cafe_id').notNullable().references('id').inTable('cafes').onDelete('CASCADE');
    t.string('video_id', 20).notNullable();
    t.string('title', 500).notNullable();
    t.string('channel_title', 200).nullable();
    t.string('thumbnail', 500).nullable();
    t.string('duration', 20).nullable();
    t.string('status', 20).defaultTo('pending'); // pending→accepted→playing→played / rejected / skipped
    t.specificType('requester_ip', 'inet').nullable();
    t.string('requester_name', 50).nullable();
    t.integer('vote_count').defaultTo(0);
    t.timestamp('requested_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('played_at', { useTz: true }).nullable();
  });

  await knex.schema.createTable('votes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('recommendation_id').notNullable().references('id').inTable('recommendations').onDelete('CASCADE');
    t.specificType('voter_ip', 'inet').notNullable();
    t.unique(['recommendation_id', 'voter_ip']);
  });

  await knex.schema.createTable('comments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('recommendation_id').notNullable().references('id').inTable('recommendations').onDelete('CASCADE');
    t.specificType('commenter_ip', 'inet').nullable();
    t.string('commenter_name', 50).nullable();
    t.string('body', 200).notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('daily_stats', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('cafe_id').notNullable().references('id').inTable('cafes').onDelete('CASCADE');
    t.date('date').notNullable();
    t.integer('total_requests').defaultTo(0);
    t.integer('total_played').defaultTo(0);
    t.integer('total_skipped').defaultTo(0);
    t.jsonb('by_hour').nullable();
    t.unique(['cafe_id', 'date']);
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('daily_stats');
  await knex.schema.dropTableIfExists('comments');
  await knex.schema.dropTableIfExists('votes');
  await knex.schema.dropTableIfExists('recommendations');
  await knex.schema.dropTableIfExists('cafes');
};
