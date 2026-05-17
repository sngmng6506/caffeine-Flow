/**
 * HIGH 우선순위 인덱스 4개 추가.
 *
 * 쿼리 패턴 분석 결과:
 *   1) recommendations(cafe_id, status, requested_at)
 *      — 손님 페이지 active queue 로드 + 사장님 history 로드 cover.
 *        현재 cafe_id FK 하나로만 잡혀 status·orderBy가 비효율.
 *   2) recommendations(cafe_id, video_id)
 *      — 신청마다 호출되는 findActiveByVideoId 중복 체크. cafe당 row 누적되면 풀스캔.
 *   3) recommendations(cafe_id, requested_at)
 *      — stats(getHourlyPattern/getDayOfWeekPattern/getSongsByWeekday/getSongsByHour)
 *        의 "최근 30일" 범위 스캔. status 필터가 없어 1번 인덱스로 cover 불가.
 *   4) cafes(owner_email)
 *      — OAuth 로그인 fallback. 자주는 아니지만 풀스캔 가능성.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('recommendations', (t) => {
    t.index(['cafe_id', 'status', 'requested_at'], 'idx_recs_active_queue');
    t.index(['cafe_id', 'video_id'],                'idx_recs_dup_check');
    t.index(['cafe_id', 'requested_at'],            'idx_recs_recent');
  });
  await knex.schema.alterTable('cafes', (t) => {
    t.index(['owner_email'], 'idx_cafes_owner_email');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.alterTable('cafes', (t) => {
    t.dropIndex(['owner_email'], 'idx_cafes_owner_email');
  });
  await knex.schema.alterTable('recommendations', (t) => {
    t.dropIndex(['cafe_id', 'requested_at'],            'idx_recs_recent');
    t.dropIndex(['cafe_id', 'video_id'],                'idx_recs_dup_check');
    t.dropIndex(['cafe_id', 'status', 'requested_at'], 'idx_recs_active_queue');
  });
};
