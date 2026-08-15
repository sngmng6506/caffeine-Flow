/**
 * 사장님이 음악 서비스 화면에서 직접 재생한 곡의 유효 재생 이력을
 * 신청곡 통계와 분리해 보존한다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('song_comments', (table) => {
    table.text('video_id').alter();
  });

  await knex.schema.createTable('playback_history', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('cafe_id').notNullable().references('id').inTable('cafes').onDelete('CASCADE');
    table.uuid('session_id').notNullable().unique();
    table.text('video_id').nullable();
    table.text('comment_key').notNullable();
    table.string('title', 200).notNullable();
    table.string('channel_title', 200).nullable();
    table.text('thumbnail').nullable();
    table.string('platform', 20).notNullable();
    table.timestamp('started_at', { useTz: true }).notNullable();
    table.timestamp('ended_at', { useTz: true }).notNullable();
    table.integer('play_duration_seconds').notNullable();
    table.string('end_reason', 20).notNullable();

    table.index(['cafe_id', 'ended_at']);
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('playback_history');

  const oversized = await knex('song_comments')
    .whereRaw('char_length(video_id) > 20')
    .first('id');
  if (oversized) {
    throw new Error('20자를 넘는 곡 댓글 식별자가 있어 song_comments.video_id를 되돌릴 수 없습니다.');
  }
  await knex.schema.alterTable('song_comments', (table) => {
    table.string('video_id', 20).alter();
  });
};
