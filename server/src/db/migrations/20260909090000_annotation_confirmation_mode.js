/**
 * 곡 라벨이 어떻게 확정됐는지 구분한다.
 *
 * `reviewed`  사람이 한 건씩 화면에서 보고 저장했다.
 * `bulk`      자동 추천값을 목록에서 한 번에 확정했다.
 *
 * 나눠 두는 이유는 평가 때문이다. 일괄 확정한 라벨은 사실상 모델 출력이라,
 * 이것으로 같은 모델을 채점하면 정확도가 실제보다 높게 나온다. 기존 행은 전부
 * 한 건씩 저장된 것이므로 `reviewed`로 채운다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('music_track_annotations', (table) => {
    table.string('confirmation_mode', 20).notNullable().defaultTo('reviewed');
  });

  await knex.raw(`
    ALTER TABLE music_track_annotations
      ADD CONSTRAINT music_track_annotations_confirmation_check
        CHECK (confirmation_mode IN ('reviewed', 'bulk'))
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.raw(`
    ALTER TABLE music_track_annotations
      DROP CONSTRAINT IF EXISTS music_track_annotations_confirmation_check
  `);
  await knex.schema.alterTable('music_track_annotations', (table) => {
    table.dropColumn('confirmation_mode');
  });
};
