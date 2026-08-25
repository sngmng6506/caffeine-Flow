/**
 * 매장 분위기 설명에서 생성한 손님용 신청곡 안내를 저장한다.
 * 기존 수동 공지 데이터는 삭제하지 않지만 런타임 노출에는 사용하지 않는다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('cafes', (table) => {
    table.string('music_filter_public_notice', 180).nullable();
    table.string('music_filter_public_notice_model', 100).nullable();
    table.timestamp('music_filter_public_notice_generated_at', { useTz: true }).nullable();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.alterTable('cafes', (table) => {
    table.dropColumn('music_filter_public_notice_generated_at');
    table.dropColumn('music_filter_public_notice_model');
    table.dropColumn('music_filter_public_notice');
  });
};
