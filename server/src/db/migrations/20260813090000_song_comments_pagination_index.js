/**
 * 곡별 최상위 댓글 페이지 조회와 해당 부모의 답글 조회를 위한 복합 인덱스.
 * video_id는 20260716120000 마이그레이션에서 이미 정규화돼 있으므로
 * 조회 시 split_part를 적용하지 않고 exact match로 인덱스를 사용한다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('song_comments', (table) => {
    table.dropIndex(['video_id', 'cafe_id']);
    table.index(['video_id', 'parent_id', 'created_at', 'id']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async (knex) => {
  await knex.schema.alterTable('song_comments', (table) => {
    table.dropIndex(['video_id', 'parent_id', 'created_at', 'id']);
    table.index(['video_id', 'cafe_id']);
  });
};
