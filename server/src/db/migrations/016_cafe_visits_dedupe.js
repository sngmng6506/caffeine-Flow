/**
 * cafe_visits 테이블에 visit_date(KST 기준 날짜) 컬럼 + UNIQUE 제약 추가.
 * 기존 중복 행 제거 후 (cafe_id, visitor_ip, visit_date) UNIQUE 적용.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  // 1) visit_date 컬럼 추가 (NULL 허용 상태)
  await knex.schema.alterTable('cafe_visits', (t) => {
    t.date('visit_date');
  });

  // 2) 기존 데이터 백필 — visited_at을 KST 자정 기준 날짜로 변환
  await knex.raw(`
    UPDATE cafe_visits
    SET visit_date = (visited_at AT TIME ZONE 'Asia/Seoul')::date
    WHERE visit_date IS NULL
  `);

  // 3) (cafe_id, visitor_ip, visit_date) 단위 중복 행 제거 — 가장 작은 id만 남김
  await knex.raw(`
    DELETE FROM cafe_visits a
    USING cafe_visits b
    WHERE a.id > b.id
      AND a.cafe_id    = b.cafe_id
      AND a.visitor_ip = b.visitor_ip
      AND a.visit_date = b.visit_date
  `);

  // 4) NOT NULL 강제 + UNIQUE 제약
  await knex.schema.alterTable('cafe_visits', (t) => {
    t.date('visit_date').notNullable().alter();
    t.unique(['cafe_id', 'visitor_ip', 'visit_date']);
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.alterTable('cafe_visits', (t) => {
    t.dropUnique(['cafe_id', 'visitor_ip', 'visit_date']);
    t.dropColumn('visit_date');
  });
};
