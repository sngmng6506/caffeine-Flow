// 3단 Audio LLM 스위치를 운영자가 Lab에서 끄고 켤 수 있도록 서버에 둔다.
// 워커 환경변수로 두면 미니PC에 접속해 파일을 고치고 재시작해야 한다.
//
// 한 줄만 존재하는 설정 테이블이다. id에 고정값 제약을 걸어 여러 줄이 생기지 않게 한다.
exports.up = async (knex) => {
  await knex.schema.createTable('audio_pipeline_settings', (t) => {
    t.integer('id').primary().defaultTo(1);
    t.boolean('audio_llm_enabled').notNullable().defaultTo(true);
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('ALTER TABLE audio_pipeline_settings ADD CONSTRAINT audio_pipeline_settings_single_row CHECK (id = 1)');
  await knex('audio_pipeline_settings').insert({ id: 1 });
};
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('audio_pipeline_settings');
};
