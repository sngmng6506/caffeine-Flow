/** MAEST 추론 원본은 매 실행마다 추가하고 최신 검토용 분석 행과 분리한다. */
exports.up = async (knex) => {
  await knex.schema.createTable('music_audio_runs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('lease_token').notNullable().unique();
    table.string('platform', 20).notNullable();
    table.text('track_key').notNullable();
    table.jsonb('payload').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['platform', 'track_key', 'created_at']);
  });
  await knex.schema.alterTable('music_audio_analyses', (table) => {
    table.uuid('latest_run_id').references('id').inTable('music_audio_runs');
    table.jsonb('maest_summary');
  });
  // 재분석·검토 과정에서 원본 변경을 DB에서도 차단한다.
  await knex.raw(`
    CREATE FUNCTION reject_audio_run_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'music_audio_runs is append-only'; END;
    $$;
    CREATE TRIGGER music_audio_runs_immutable BEFORE UPDATE OR DELETE ON music_audio_runs
      FOR EACH ROW EXECUTE FUNCTION reject_audio_run_mutation();
  `);
};

exports.down = async (knex) => {
  // 원본을 제거하는 롤백은 의도적으로 거절한다. 별도 백업·관리 작업이 필요하다.
  const [{ count }] = await knex('music_audio_runs').count('* as count');
  if (Number(count)) throw new Error('MAEST 원본이 존재해 자동 롤백할 수 없습니다');
  await knex.schema.alterTable('music_audio_analyses', (table) => {
    table.dropColumn('latest_run_id');
    table.dropColumn('maest_summary');
  });
  await knex.schema.dropTable('music_audio_runs');
  await knex.raw('DROP FUNCTION reject_audio_run_mutation()');
};
