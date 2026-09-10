exports.up = async (knex) => {
  await knex.schema.alterTable('music_audio_analyses', (t) => t.string('human_verdict', 20));
  await knex.schema.alterTable('music_track_annotations', (t) => t.boolean('human_edited').notNullable().defaultTo(false));
  await knex('music_track_annotations').where({ human_review_status: 'corrected' }).update({ human_edited: true });
  // 과거에는 수정 여부가 판정으로 덮였다. 자동 원본과 다르거나 비교할 원본이
  // 없으면 직접 수정 가능성이 있으므로 사람 라벨을 보수적으로 보존한다.
  await knex.raw(`UPDATE music_track_annotations n SET human_edited = true
    WHERE n.label_source = 'human' AND n.human_review_status IN ('inaccurate', 'unclear')
      AND NOT EXISTS (
        SELECT 1 FROM music_audio_jobs j JOIN music_audio_analyses a ON a.id = j.analysis_id
        WHERE j.platform = n.platform AND j.track_key = n.track_key
          AND a.automatic_annotation IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM unnest(ARRAY['genre_tags', 'tempo_class', 'rhythmic_character',
              'mood_tags', 'vocal_type', 'instrumentation_type', 'track_version']) AS fields(name)
            WHERE to_jsonb(n)->fields.name IS DISTINCT FROM a.automatic_annotation->fields.name
          )
      )`);
  // 기존 틀림 판정은 연결된 분석이 아직 검토 완료인 경우에만 이관한다.
  await knex.raw(`UPDATE music_audio_analyses a SET human_verdict = n.human_review_status
    FROM music_audio_jobs j JOIN music_track_annotations n ON n.platform = j.platform AND n.track_key = j.track_key
    WHERE a.id = j.analysis_id AND a.review_status = 'reviewed'
      AND n.human_review_status IN ('inaccurate', 'unclear')`);
  await knex('music_track_annotations').where({ label_source: 'human', human_edited: false })
    .whereIn('human_review_status', ['inaccurate', 'unclear'])
    .update({ label_source: 'automatic', reviewed_fields: '[]' });
  await knex.schema.alterTable('music_source_cursors', (t) => t.jsonb('pending_window'));
  await knex.schema.alterTable('music_source_discoveries', (t) => {
    t.jsonb('claimed_window');
    t.integer('claimed_offset');
  });
};
exports.down = async (knex) => {
  await knex.schema.alterTable('music_source_discoveries', (t) => t.dropColumns('claimed_window', 'claimed_offset'));
  await knex.schema.alterTable('music_source_cursors', (t) => t.dropColumn('pending_window'));
  await knex.schema.alterTable('music_track_annotations', (t) => t.dropColumn('human_edited'));
  await knex.schema.alterTable('music_audio_analyses', (t) => t.dropColumn('human_verdict'));
};
