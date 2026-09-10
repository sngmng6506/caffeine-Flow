import { afterAll, expect, it } from 'vitest';
import crypto from 'node:crypto';
const db = (await import('../src/db/knex.js')).default;
const migration = (await import('../src/db/migrations/20260911100000_audio_review_and_discovery_pages.js')).default;
afterAll(() => db.destroy());

it('기존 판정은 이관하고 수정 가능성이 있는 사람 라벨은 보존한다', async () => {
  await db.transaction(async (trx) => {
    // 운영 테이블과 같은 타입의 임시 테이블에서 마이그레이션 전 상태를 재현한다.
    for (const name of ['music_audio_analyses', 'music_track_annotations', 'music_audio_jobs', 'music_source_cursors', 'music_source_discoveries']) {
      await trx.raw('CREATE TEMP TABLE ?? ON COMMIT DROP AS SELECT * FROM public.?? WITH NO DATA', [name, name]);
    }
    await trx.schema.alterTable('music_audio_analyses', (t) => t.dropColumn('human_verdict'));
    await trx.schema.alterTable('music_track_annotations', (t) => t.dropColumn('human_edited'));
    await trx.schema.alterTable('music_source_cursors', (t) => t.dropColumn('pending_window'));
    await trx.schema.alterTable('music_source_discoveries', (t) => t.dropColumns('claimed_window', 'claimed_offset'));
    const automatic = { genre_tags: ['jazz'], tempo_class: 'moderate', rhythmic_character: 'steady',
      mood_tags: [], vocal_type: 'unknown', instrumentation_type: 'unknown', track_version: 'unknown' };
    for (const key of ['confirmed-only', 'edited', 'missing-original']) {
      const analysisId = crypto.randomUUID();
      await trx('music_audio_analyses').insert({ id: analysisId, review_status: 'reviewed',
        automatic_annotation: key === 'missing-original' ? null : JSON.stringify(automatic) });
      await trx('music_audio_jobs').insert({ platform: 'youtube', track_key: key, analysis_id: analysisId });
      await trx('music_track_annotations').insert({ ...automatic, platform: 'youtube', track_key: key,
        genre_tags: JSON.stringify(key === 'edited' ? ['rock_metal'] : automatic.genre_tags), mood_tags: '[]',
        label_source: 'human', human_review_status: 'inaccurate', reviewed_fields: '["genre_tags"]' });
    }
    await migration.up(trx);
    const rows = await trx('music_track_annotations').orderBy('track_key');
    expect(rows.map((row) => [row.track_key, row.human_edited, row.label_source])).toEqual([
      ['confirmed-only', false, 'automatic'], ['edited', true, 'human'], ['missing-original', true, 'human'],
    ]);
    expect(rows[0].reviewed_fields).toEqual([]);
    expect((await trx('music_audio_analyses')).every((row) => row.human_verdict === 'inaccurate')).toBe(true);
  });
});
