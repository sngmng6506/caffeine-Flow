/** MAEST를 걷어낸 뒤 남은 이름을 실제 내용에 맞춘다.
 *
 * 컬럼에는 이제 감정값·자유 서술만 들어간다. 이름만 바꾸므로 기존 값은 그대로
 * 보존된다. `music_audio_runs.payload`의 옛 `maest_raw`도 읽는 코드가 사라질 뿐
 * 지우지 않는다 — 원본은 append-only 계약으로 트리거가 지키고 있다.
 */
exports.up = async (knex) => {
  await knex.schema.alterTable('music_audio_analyses', (table) => {
    table.renameColumn('maest_summary', 'analysis_summary');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('music_audio_analyses', (table) => {
    table.renameColumn('analysis_summary', 'maest_summary');
  });
};
