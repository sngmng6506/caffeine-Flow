/**
 * 카페 위치에 동(법정동/행정동) 컬럼 추가.
 *
 * 손님 대상 지역 탐색(향후 매장 디렉토리)의 최소 단위를 동으로 잡는다.
 * region(시/도)·district(시/군/구)는 015에 이미 있고, 여기에 dong을
 * 더해 "서울 마포구 연남동" 수준으로 특정한다. 정밀 도로명·상세주소는
 * 손님 발견 목적에 불필요하고 최소수집 원칙에도 어긋나므로 저장하지 않는다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = (knex) =>
  knex.schema.alterTable('cafes', (t) => {
    t.string('dong', 50).nullable();
  });

/**
 * @param {import('knex').Knex} knex
 */
exports.down = (knex) =>
  knex.schema.alterTable('cafes', (t) => {
    t.dropColumn('dong');
  });
