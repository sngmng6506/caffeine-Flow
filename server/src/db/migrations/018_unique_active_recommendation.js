/**
 * 활성 상태(pending/accepted/playing) 추천곡에 대한 (cafe_id, video_id)
 * partial unique index.
 *
 * 라우트의 findActiveByVideoId 사전 체크는 insert와 원자적이지 않아
 * 동시 요청 시 중복이 뚫림 — DB 제약으로 확정한다. 라우트는 23505를
 * 잡아 409로 응답 (votes 테이블과 동일 패턴).
 *
 * 인덱스 생성 전, 이미 존재할 수 있는 활성 중복 행을 정리:
 * 같은 (cafe_id, video_id)의 활성 행 중 가장 오래된 것만 남기고
 * 나머지는 rejected 처리 (삭제 대신 상태 변경 — 데이터 보존).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.raw(`
    UPDATE recommendations SET status = 'rejected'
    WHERE status IN ('pending', 'accepted', 'playing')
      AND id NOT IN (
        SELECT MIN(id) FROM recommendations
        WHERE status IN ('pending', 'accepted', 'playing')
        GROUP BY cafe_id, video_id
      )
      AND id IN (
        SELECT id FROM recommendations r
        WHERE r.status IN ('pending', 'accepted', 'playing')
          AND EXISTS (
            SELECT 1 FROM recommendations d
            WHERE d.cafe_id = r.cafe_id AND d.video_id = r.video_id
              AND d.status IN ('pending', 'accepted', 'playing')
              AND d.id < r.id
          )
      )
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX idx_recs_unique_active
    ON recommendations (cafe_id, video_id)
    WHERE status IN ('pending', 'accepted', 'playing')
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS idx_recs_unique_active');
};
