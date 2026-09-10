// 수집 소스별 진행 위치. 버튼을 누를 때마다 같은 상위 N을 다시 훑지 않고 다음
// 구간으로 넘어가게 한다.
//
// 곡 중복은 (platform, track_key) unique가 이미 막는다. 이 커서는 정확성이 아니라
// **진도**를 위한 것이다 — 없으면 눌러도 새 곡이 안 늘어난다.
exports.up = async (knex) => {
  await knex.schema.createTable('music_source_cursors', (t) => {
    t.string('source', 40).notNullable();
    // 검색어가 있는 소스는 검색어마다 진도가 따로다. 없으면 빈 문자열.
    t.string('query_key', 200).notNullable().defaultTo('');
    t.integer('next_offset').notNullable().defaultTo(0);
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['source', 'query_key']);
  });
};
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('music_source_cursors');
};
