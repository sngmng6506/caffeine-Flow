/**
 * 같은 카페 Wi-Fi의 여러 손님이 하나의 공인 IP를 공유하므로 visitor_id가
 * 있는 최신 클라이언트는 visitor_id로, 없는 레거시 요청만 IP로 중복을 막는다.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.raw(`
    DELETE FROM votes
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY recommendation_id, visitor_id
          ORDER BY id
        ) AS rn
        FROM votes
        WHERE visitor_id IS NOT NULL
      ) ranked
      WHERE rn > 1
    )
  `);

  await knex.raw('ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_recommendation_id_voter_ip_unique');
  await knex.raw(`
    CREATE UNIQUE INDEX votes_rec_visitor_unique
    ON votes (recommendation_id, visitor_id)
    WHERE visitor_id IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX votes_rec_legacy_ip_unique
    ON votes (recommendation_id, voter_ip)
    WHERE visitor_id IS NULL
  `);

  // 삭제된 과거 중복 가능성을 포함해 캐시된 vote_count를 실제 표와 맞춘다.
  await knex.raw(`
    UPDATE recommendations r
    SET vote_count = (SELECT COUNT(*) FROM votes v WHERE v.recommendation_id = r.id)
  `);

  await knex.raw(`
    DELETE FROM cafe_visits
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY cafe_id, visitor_id, visit_date
          ORDER BY visited_at, id
        ) AS rn
        FROM cafe_visits
        WHERE visitor_id IS NOT NULL
      ) ranked
      WHERE rn > 1
    )
  `);

  await knex.raw('ALTER TABLE cafe_visits DROP CONSTRAINT IF EXISTS cafe_visits_cafe_id_visitor_ip_visit_date_unique');
  await knex.raw(`
    CREATE UNIQUE INDEX cafe_visits_visitor_day_unique
    ON cafe_visits (cafe_id, visitor_id, visit_date)
    WHERE visitor_id IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX cafe_visits_legacy_ip_day_unique
    ON cafe_visits (cafe_id, visitor_ip, visit_date)
    WHERE visitor_id IS NULL AND visitor_ip IS NOT NULL
  `);
};

exports.down = async (knex) => {
  // 동일 IP의 여러 visitor 행은 옛 UNIQUE 제약과 충돌하므로 가장 오래된
  // 행만 보존한 뒤 원래 IP 기반 제약으로 되돌린다.
  await knex.raw(`
    DELETE FROM votes
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY recommendation_id, voter_ip
          ORDER BY id
        ) AS rn
        FROM votes
      ) ranked
      WHERE rn > 1
    )
  `);
  await knex.raw('DROP INDEX IF EXISTS votes_rec_visitor_unique');
  await knex.raw('DROP INDEX IF EXISTS votes_rec_legacy_ip_unique');
  await knex.raw('ALTER TABLE votes ADD CONSTRAINT votes_recommendation_id_voter_ip_unique UNIQUE (recommendation_id, voter_ip)');

  await knex.raw(`
    DELETE FROM cafe_visits
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY cafe_id, visitor_ip, visit_date
          ORDER BY visited_at, id
        ) AS rn
        FROM cafe_visits
      ) ranked
      WHERE rn > 1
    )
  `);
  await knex.raw('DROP INDEX IF EXISTS cafe_visits_visitor_day_unique');
  await knex.raw('DROP INDEX IF EXISTS cafe_visits_legacy_ip_day_unique');
  await knex.raw('ALTER TABLE cafe_visits ADD CONSTRAINT cafe_visits_cafe_id_visitor_ip_visit_date_unique UNIQUE (cafe_id, visitor_ip, visit_date)');

  await knex.raw(`
    UPDATE recommendations r
    SET vote_count = (SELECT COUNT(*) FROM votes v WHERE v.recommendation_id = r.id)
  `);
};
