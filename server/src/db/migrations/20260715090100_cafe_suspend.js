/**
 * 카페 정지 플래그(is_suspended) 추가.
 *
 * 사장님 계정은 Google/Naver OAuth로 누구나 생성 가능하므로(공개 exe 배포),
 * 사후 관리 수단이 필요하다. 완전 삭제는 cafes의 onDelete('CASCADE')로
 * recommendations·votes·cafe_visits·daily_stats까지 함께 소멸해 되돌릴 수 없다.
 * 되돌릴 수 있는 정지를 1차 조치로 두고, 삭제는 확실한 경우에만 쓴다.
 *
 * 정지 시 손님 접근(큐 조회·신청·댓글)이 차단된다. 사장님 로그인 자체는
 * 막지 않는다 — 오조치 복구와 소명 여지를 남기기 위함.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = (knex) =>
  knex.schema.alterTable('cafes', (t) => {
    t.boolean('is_suspended').notNullable().defaultTo(false);
    t.index(['is_suspended']);
  });

/**
 * @param {import('knex').Knex} knex
 */
exports.down = (knex) =>
  knex.schema.alterTable('cafes', (t) => {
    t.dropIndex(['is_suspended']);
    t.dropColumn('is_suspended');
  });
