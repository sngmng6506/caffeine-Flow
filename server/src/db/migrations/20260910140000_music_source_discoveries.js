// 최신곡 수집 요청 큐. 운영자가 Lab에서 누르면 한 줄이 쌓이고 워커가 가져간다.
//
// 곡 목록 조회와 플랫폼 검색은 워커가 한다. 서버에는 yt-dlp가 없고, Railway에서
// 검색하면 공용 IP가 막힐 수 있다.
exports.up = async (knex) => {
  await knex.schema.createTable('music_source_discoveries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('source', 40).notNullable();
    t.string('query', 200);
    t.integer('requested_limit').notNullable().defaultTo(20);
    t.string('status', 20).notNullable().defaultTo('queued');
    t.uuid('lease_token');
    t.timestamp('lease_until');
    t.integer('attempts').notNullable().defaultTo(0);
    t.integer('found_count').notNullable().defaultTo(0);
    t.integer('enqueued_count').notNullable().defaultTo(0);
    t.string('error_code', 80);
    t.timestamps(true, true);
    t.index(['status', 'created_at']);
  });
};
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('music_source_discoveries');
};
