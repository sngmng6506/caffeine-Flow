// 좋아요를 신청곡(recommendation) 단위에서 곡(track) 단위로 바꾼다.
//
// 왜: 같은 곡이 여러 번 신청되면 행이 여러 개 생긴다. 최근 재생 탭은 그 행들을
// 따로 보여주고 TOP은 하나로 묶어 보여주는데, 표가 행 단위라 한 사람이 같은 곡에
// 여러 번 투표할 수 있었고 TOP에서는 투표할 대상 자체가 없었다.
// 이제 (카페, 곡, 방문자)당 한 표만 허용하고, 같은 카페·같은 곡의 모든 행이
// 같은 vote_count를 공유한다.
//
// 계약: docs/AI_CHANGE_GUARDRAILS.md#anonymous-visitor-identity-contract
const { CANONICAL_VIDEO_ID_SQL } = require('../sql-fragments');

exports.up = async function (knex) {
  await knex.schema.alterTable('votes', (t) => {
    t.uuid('cafe_id').nullable().references('id').inTable('cafes').onDelete('CASCADE');
    t.text('track_key').nullable();
  });

  // 기존 표에 카페와 곡 키를 채운다.
  await knex.raw(`
    UPDATE votes v
    SET cafe_id = r.cafe_id,
        track_key = ${CANONICAL_VIDEO_ID_SQL.replace('video_id', 'r.video_id')}
    FROM recommendations r
    WHERE v.recommendation_id = r.id
  `);

  // 곡 키를 만들 수 없는 표(참조가 이미 끊긴 경우)는 남겨둘 수 없다.
  await knex('votes').whereNull('cafe_id').orWhereNull('track_key').delete();

  // 같은 사람이 같은 곡의 다른 신청에 던진 중복 표를 한 표로 정리한다.
  // 삭제가 아니라 병합이므로 가장 오래된 표를 남긴다.
  await knex.raw(`
    DELETE FROM votes v USING votes keep
    WHERE v.id <> keep.id
      AND v.cafe_id = keep.cafe_id
      AND v.track_key = keep.track_key
      AND v.visitor_id IS NOT NULL
      AND v.visitor_id = keep.visitor_id
      AND keep.id < v.id
  `);
  await knex.raw(`
    DELETE FROM votes v USING votes keep
    WHERE v.id <> keep.id
      AND v.cafe_id = keep.cafe_id
      AND v.track_key = keep.track_key
      AND v.visitor_id IS NULL AND keep.visitor_id IS NULL
      AND v.voter_ip = keep.voter_ip
      AND keep.id < v.id
  `);

  await knex.schema.alterTable('votes', (t) => {
    t.uuid('cafe_id').notNullable().alter();
    t.text('track_key').notNullable().alter();
  });

  // 신청곡이 취소·삭제돼도 곡 좋아요는 남는다.
  await knex.raw('ALTER TABLE votes ALTER COLUMN recommendation_id DROP NOT NULL');
  await knex.raw('ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_recommendation_id_foreign');
  await knex.raw(`
    ALTER TABLE votes
    ADD CONSTRAINT votes_recommendation_id_foreign
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE SET NULL
  `);

  // 추천곡 단위 유니크는 곡 단위 유니크로 대체된다. 남겨두면 의미가 겹쳐
  // 어느 쪽이 실제 중복 방지인지 읽는 사람이 알 수 없다.
  await knex.raw('ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_recommendation_id_voter_ip_unique');
  await knex.raw('DROP INDEX IF EXISTS votes_rec_visitor_unique');
  await knex.raw('DROP INDEX IF EXISTS votes_rec_legacy_ip_unique');

  // visitor ID가 있으면 그것이 신원이고, 없는 레거시 요청만 IP로 막는다.
  await knex.raw(`
    CREATE UNIQUE INDEX votes_song_visitor_unique
    ON votes (cafe_id, track_key, visitor_id)
    WHERE visitor_id IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX votes_song_ip_unique
    ON votes (cafe_id, track_key, voter_ip)
    WHERE visitor_id IS NULL
  `);
  await knex.raw('CREATE INDEX votes_cafe_track_idx ON votes (cafe_id, track_key)');

  // 같은 카페·같은 곡의 모든 행이 곡의 실제 표 수를 갖게 맞춘다.
  await knex.raw(`
    UPDATE recommendations r
    SET vote_count = COALESCE(counted.total, 0)
    FROM (
      SELECT cafe_id, track_key, count(*)::int AS total
      FROM votes GROUP BY cafe_id, track_key
    ) counted
    WHERE r.cafe_id = counted.cafe_id
      AND ${CANONICAL_VIDEO_ID_SQL.replace('video_id', 'r.video_id')} = counted.track_key
  `);
  await knex.raw(`
    UPDATE recommendations r SET vote_count = 0
    WHERE vote_count <> 0 AND NOT EXISTS (
      SELECT 1 FROM votes v
      WHERE v.cafe_id = r.cafe_id
        AND v.track_key = ${CANONICAL_VIDEO_ID_SQL.replace('video_id', 'r.video_id')}
    )
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS votes_song_visitor_unique');
  await knex.raw('DROP INDEX IF EXISTS votes_song_ip_unique');
  await knex.raw('DROP INDEX IF EXISTS votes_cafe_track_idx');

  // 곡 단위로 병합된 표는 되돌릴 수 없다. 신청곡을 잃은 표만 정리하고
  // 나머지는 원래의 행 단위 제약으로 되돌린다.
  await knex('votes').whereNull('recommendation_id').delete();
  await knex.raw('ALTER TABLE votes ALTER COLUMN recommendation_id SET NOT NULL');
  await knex.raw('ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_recommendation_id_foreign');
  await knex.raw(`
    ALTER TABLE votes
    ADD CONSTRAINT votes_recommendation_id_foreign
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE
  `);
  await knex.raw(`
    ALTER TABLE votes ADD CONSTRAINT votes_recommendation_id_voter_ip_unique
    UNIQUE (recommendation_id, voter_ip)
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX votes_rec_visitor_unique
    ON votes (recommendation_id, visitor_id) WHERE visitor_id IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX votes_rec_legacy_ip_unique
    ON votes (recommendation_id, voter_ip) WHERE visitor_id IS NULL
  `);

  await knex.schema.alterTable('votes', (t) => {
    t.dropColumn('cafe_id');
    t.dropColumn('track_key');
  });

  await knex.raw(`
    UPDATE recommendations r
    SET vote_count = COALESCE((SELECT count(*) FROM votes v WHERE v.recommendation_id = r.id), 0)
  `);
};
