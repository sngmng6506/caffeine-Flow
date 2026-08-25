/**
 * 사람이 직접 들은 곡의 선택형 특성을 플랫폼 곡 식별자별로 한 건 보존한다.
 * 매장 정책 정답은 music_filter_reviews에 남기고 곡 자체의 특성과 분리한다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.schema.createTable('music_track_annotations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('platform', 20).notNullable();
    table.text('track_key').notNullable();
    table.uuid('source_recommendation_id')
      .nullable()
      .references('id')
      .inTable('recommendations')
      .onDelete('SET NULL');
    table.string('title', 500).notNullable();
    table.string('artist_name', 200).notNullable();
    table.string('artist_key', 200).notNullable();
    table.string('track_version', 20).notNullable();
    table.string('tempo_class', 20).notNullable();
    table.jsonb('mood_tags').notNullable().defaultTo('[]');
    table.string('instrumentation_type', 20).notNullable();
    table.string('rhythmic_character', 20).notNullable();
    table.string('vocal_type', 20).notNullable();
    table.jsonb('genre_tags').notNullable().defaultTo('[]');
    table.text('note').nullable();
    table.string('usage_scope', 20).notNullable();
    table.smallint('schema_version').notNullable().defaultTo(1);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['platform', 'track_key']);
    table.index(['artist_key', 'updated_at']);
  });

  await knex.raw(`
    ALTER TABLE music_track_annotations
      ADD CONSTRAINT music_track_annotations_version_check
        CHECK (track_version IN ('original', 'live', 'remix', 'cover', 'edited', 'unknown')),
      ADD CONSTRAINT music_track_annotations_tempo_check
        CHECK (tempo_class IN ('very_slow', 'slow', 'moderate', 'fast', 'very_fast', 'unknown')),
      ADD CONSTRAINT music_track_annotations_moods_check
        CHECK (
          jsonb_typeof(mood_tags) = 'array'
          AND jsonb_array_length(mood_tags) BETWEEN 1 AND 2
        ),
      ADD CONSTRAINT music_track_annotations_instrumentation_check
        CHECK (instrumentation_type IN ('acoustic', 'electronic', 'hybrid', 'unknown')),
      ADD CONSTRAINT music_track_annotations_rhythm_check
        CHECK (rhythmic_character IN ('minimal', 'steady', 'danceable', 'heavy_beat', 'irregular', 'unknown')),
      ADD CONSTRAINT music_track_annotations_vocal_check
        CHECK (vocal_type IN ('none', 'singing', 'rap_spoken', 'unknown')),
      ADD CONSTRAINT music_track_annotations_genres_check
        CHECK (
          jsonb_typeof(genre_tags) = 'array'
          AND jsonb_array_length(genre_tags) <= 2
        ),
      ADD CONSTRAINT music_track_annotations_usage_check
        CHECK (usage_scope IN ('operational', 'evaluation')),
      ADD CONSTRAINT music_track_annotations_schema_check
        CHECK (schema_version = 1)
  `);

  await knex.raw(`
    ALTER TABLE music_filter_reviews
      DROP CONSTRAINT music_filter_reviews_decision_check,
      ADD CONSTRAINT music_filter_reviews_decision_check
        CHECK (human_decision IN ('accept', 'reject', 'undetermined'))
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex('music_filter_reviews').where({ human_decision: 'undetermined' }).del();
  await knex.raw(`
    ALTER TABLE music_filter_reviews
      DROP CONSTRAINT music_filter_reviews_decision_check,
      ADD CONSTRAINT music_filter_reviews_decision_check
        CHECK (human_decision IN ('accept', 'reject'))
  `);
  await knex.schema.dropTableIfExists('music_track_annotations');
};
