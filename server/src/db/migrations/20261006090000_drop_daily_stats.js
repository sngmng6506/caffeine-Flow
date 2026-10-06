// daily_stats를 지운다.
//
// 이 테이블을 읽는 코드도 쓰는 코드도 남아 있지 않다. 피크 동시접속 갱신은
// 8c0f4b3에서 지웠고, 나머지 칸(total_requests 등)은 처음부터 쓰는 코드가 없었다.
// 사장님 통계는 recommendations를, 운영자 방문 수는 cafe_visits를 직접 집계한다.
//
// 되돌릴 수 없다: down은 구조만 다시 만들고 지워진 옛 피크 값은 돌아오지 않는다
// (운영자 판단으로 지운다).
exports.up = async function (knex) {
  await knex.schema.dropTableIfExists('daily_stats');
};

// 001_initial과 013_concurrent_visitors가 만든 구조 그대로.
exports.down = async function (knex) {
  await knex.schema.createTable('daily_stats', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('cafe_id').notNullable().references('id').inTable('cafes').onDelete('CASCADE');
    t.date('date').notNullable();
    t.integer('total_requests').defaultTo(0);
    t.integer('total_played').defaultTo(0);
    t.integer('total_skipped').defaultTo(0);
    t.jsonb('by_hour').nullable();
    t.integer('peak_concurrent').defaultTo(0);
    t.unique(['cafe_id', 'date']);
  });
};
