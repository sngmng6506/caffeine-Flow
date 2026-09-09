// 기존 신청곡도 자동 분석 큐에 포함한다. 원본 음원은 DB에 저장하지 않는다.
exports.up = async (knex) => {
  await knex.schema.createTable('music_audio_jobs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('platform', 20).notNullable();
    t.text('track_key').notNullable();
    t.string('title', 500).notNullable();
    t.string('artist_name', 200).notNullable().defaultTo('unknown');
    t.string('status', 20).notNullable().defaultTo('queued');
    t.integer('attempts').notNullable().defaultTo(0);
    t.uuid('lease_token').nullable();
    t.timestamp('lease_until', { useTz: true });
    t.timestamp('available_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('error_code', 60).nullable();
    t.uuid('analysis_id').nullable().references('id').inTable('music_audio_analyses').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['platform', 'track_key']);
    t.index(['status', 'available_at']);
  });
  await knex.raw("ALTER TABLE music_audio_jobs ADD CONSTRAINT audio_job_status_check CHECK (status IN ('queued','processing','completed','failed','unsupported'))");
  await knex.schema.alterTable('music_audio_analyses', (t) => {
    t.integer('revision').notNullable().defaultTo(1);
    t.jsonb('automatic_annotation').nullable();
    t.jsonb('tag_scores').notNullable().defaultTo('{}');
  });
  await knex.schema.alterTable('music_track_annotations', (t) => {
    // 기존 수동 라벨은 자동 분석으로 덮어쓰지 않는다.
    t.string('label_source', 20).notNullable().defaultTo('human');
    t.string('human_review_status', 20).notNullable().defaultTo('confirmed');
    t.integer('revision').notNullable().defaultTo(1);
  });
  await knex.raw(`ALTER TABLE music_audio_analyses DROP CONSTRAINT music_audio_analyses_rights_check,
    ADD CONSTRAINT music_audio_analyses_rights_check CHECK (rights_basis IN ('owned','licensed','public_domain','other_authorized','platform_stream'))`);
  await knex.raw(`INSERT INTO music_audio_jobs (platform, track_key, title, artist_name, status, error_code)
    SELECT DISTINCT ON (platform, video_id) platform, video_id, LEFT(title,500),
      LEFT(COALESCE(NULLIF(channel_title,''),'unknown'),200),
      CASE WHEN platform IN ('youtube','soundcloud') THEN 'queued' ELSE 'unsupported' END,
      CASE WHEN platform IN ('youtube','soundcloud') THEN NULL ELSE 'PLATFORM_UNSUPPORTED' END
    FROM recommendations ORDER BY platform, video_id, requested_at DESC, id DESC
    ON CONFLICT (platform, track_key) DO NOTHING`);
};
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('music_audio_jobs');
  await knex.schema.alterTable('music_track_annotations', (t) => t.dropColumns('label_source', 'human_review_status', 'revision'));
  await knex.schema.alterTable('music_audio_analyses', (t) => t.dropColumns('revision', 'automatic_annotation', 'tag_scores'));
  // 새 출처 값을 가진 결과는 보존한다. 다운로드 출처를 권리 허가로 바꾸지 않는다.
};
