exports.up = async (knex) => {
  await knex.schema.alterTable('music_audio_jobs', (t) => {
    t.integer('generation').notNullable().defaultTo(1);
  });
  await knex.schema.alterTable('music_track_annotations', (t) => {
    t.boolean('artist_confirmed').notNullable().defaultTo(false);
    t.jsonb('reviewed_fields').notNullable().defaultTo('[]');
  });
  // 기존 일괄 확인에서 아티스트까지 검증했는지 알 수 없어 보수적으로 미확인으로 둔다.
  // 일시적 다운로드 장애로 끝났던 작업은 자동 복구 기회를 다시 준다.
  await knex('music_audio_jobs').where({ status: 'failed' })
    .whereIn('error_code', ['DOWNLOAD_FAILED', 'MODEL_UNAVAILABLE'])
    .update({ status: 'queued', available_at: knex.raw("now() + interval '6 hours'"), lease_token: null });
};
exports.down = async (knex) => {
  await knex.schema.alterTable('music_track_annotations', (t) => t.dropColumns('artist_confirmed', 'reviewed_fields'));
  await knex.schema.alterTable('music_audio_jobs', (t) => t.dropColumn('generation'));
};
