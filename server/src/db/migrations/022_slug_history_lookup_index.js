/**
 * cafe_slug_history에 (old_slug, changed_at) 복합 인덱스 추가.
 *
 * findMovedSlug가 옛 slug를 마지막으로 소유했던 카페를 찾을 때, old_slug로
 * 필터링한 뒤 changed_at 내림차순으로 정렬한 첫 행을 본다. 021의
 * old_slug 단일 인덱스로도 동작하나, slug 재사용(버려진 slug를 다른
 * 카페가 가져가는 경우) 정확성을 위해 정렬 컬럼까지 포함한 복합 인덱스로
 * 조회를 안정화한다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = (knex) =>
  knex.schema.alterTable('cafe_slug_history', (t) => {
    t.index(['old_slug', 'changed_at'], 'idx_slug_history_lookup');
  });

/**
 * @param {import('knex').Knex} knex
 */
exports.down = (knex) =>
  knex.schema.alterTable('cafe_slug_history', (t) => {
    t.dropIndex(['old_slug', 'changed_at'], 'idx_slug_history_lookup');
  });
