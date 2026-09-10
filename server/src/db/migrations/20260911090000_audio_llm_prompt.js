// 3단 Audio LLM 시스템 프롬프트를 Lab에서 고칠 수 있게 서버에 둔다.
// 워커의 j2 템플릿으로만 두면 미니PC에 접속해 파일을 고치고 재시작해야 한다.
//
// 프롬프트 본문은 append-only 이력에 남긴다. audio_llm_raw가 prompt_version만
// 보존하므로, 프롬프트를 고친 뒤에는 옛 서술이 어떤 문장으로 만들어졌는지
// 되짚을 방법이 사라진다. 이력 한 줄이 그 연결을 유지한다.
exports.up = async (knex) => {
  await knex.schema.createTable('audio_prompt_revisions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('sha256', 64).notNullable().unique();
    t.text('body').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  // 원본은 고치거나 지우지 않는다. music_audio_runs와 같은 규칙이다.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION audio_prompt_revisions_immutable() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION '프롬프트 이력은 수정하거나 삭제할 수 없습니다'; END;
    $$ LANGUAGE plpgsql`);
  await knex.raw(`
    CREATE TRIGGER audio_prompt_revisions_no_change BEFORE UPDATE OR DELETE ON audio_prompt_revisions
    FOR EACH ROW EXECUTE FUNCTION audio_prompt_revisions_immutable()`);

  // NULL이면 워커가 들고 있는 기본 템플릿을 쓴다.
  await knex.schema.alterTable('audio_pipeline_settings', (t) => {
    t.text('audio_llm_prompt').nullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('audio_pipeline_settings', (t) => t.dropColumn('audio_llm_prompt'));
  await knex.raw('DROP TRIGGER IF EXISTS audio_prompt_revisions_no_change ON audio_prompt_revisions');
  await knex.schema.dropTableIfExists('audio_prompt_revisions');
  await knex.raw('DROP FUNCTION IF EXISTS audio_prompt_revisions_immutable()');
};
