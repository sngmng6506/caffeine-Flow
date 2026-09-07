/**
 * 권리가 확인된 로컬 음원에서 추출한 자동 분석 결과를 곡별·모델별로 보존한다.
 * 원본 오디오는 서버에 전송하거나 저장하지 않는다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.createTable('music_audio_analyses', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('platform', 20).notNullable();
    table.text('track_key').notNullable();
    table.string('model_name', 100).notNullable();
    table.string('model_version', 100).notNullable();
    table.smallint('feature_schema_version').notNullable().defaultTo(1);
    table.string('rights_basis', 30).notNullable();
    table.string('source_reference', 500).notNullable();
    table.jsonb('features').notNullable();
    table.jsonb('suggested_annotation').notNullable().defaultTo('{}');
    table.string('review_status', 20).notNullable().defaultTo('pending');
    table.timestamp('analyzed_at', { useTz: true }).notNullable();
    table.timestamp('reviewed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['platform', 'track_key', 'model_name', 'model_version']);
    table.index(['platform', 'track_key', 'analyzed_at']);
    table.index(['review_status', 'analyzed_at']);
  });

  await knex.raw(`
    ALTER TABLE music_audio_analyses
      ADD CONSTRAINT music_audio_analyses_platform_check
        CHECK (platform IN ('youtube', 'soundcloud', 'spotify')),
      ADD CONSTRAINT music_audio_analyses_rights_check
        CHECK (rights_basis IN ('owned', 'licensed', 'public_domain', 'other_authorized')),
      ADD CONSTRAINT music_audio_analyses_review_check
        CHECK (review_status IN ('pending', 'reviewed')),
      ADD CONSTRAINT music_audio_analyses_features_check
        CHECK (jsonb_typeof(features) = 'object'),
      ADD CONSTRAINT music_audio_analyses_suggestion_check
        CHECK (jsonb_typeof(suggested_annotation) = 'object'),
      ADD CONSTRAINT music_audio_analyses_schema_check
        CHECK (feature_schema_version = 1)
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('music_audio_analyses');
};
