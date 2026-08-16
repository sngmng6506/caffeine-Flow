/**
 * 감사 조회용 (cafe_id, filter_checked_at) 인덱스를 CONCURRENTLY로 생성한다.
 *
 * recommendations는 손님 신청이 계속 INSERT되는 테이블이라, 일반
 * CREATE INDEX는 빌드 동안 SHARE 락으로 신청 쓰기를 막는다. CONCURRENTLY는
 * 락 없이 만들지만 트랜잭션 안에서 실행할 수 없어 이 마이그레이션만
 * transaction:false로 둔다. (앞으로 대형 테이블 인덱스는 이 패턴을 따른다.)
 *
 * IF NOT EXISTS라 이미 인덱스가 있는 기존 배포에서는 no-op다. 만약
 * CONCURRENTLY 빌드가 중간에 실패하면 INVALID 인덱스가 남을 수 있으므로,
 * 그 경우 수동으로 DROP INDEX 후 재배포한다.
 */
exports.config = { transaction: false };

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recommendations_filter_audit
    ON recommendations (cafe_id, filter_checked_at)
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_recommendations_filter_audit');
};
