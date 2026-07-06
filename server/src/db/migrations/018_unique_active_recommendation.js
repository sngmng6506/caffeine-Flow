/**
 * 활성 상태(pending/accepted/playing) 추천곡에 대한 (cafe_id, video_id)
 * partial unique index.
 *
 * 라우트의 findActiveByVideoId 사전 체크는 insert와 원자적이지 않아
 * 동시 요청 시 중복이 뚫린다 — DB 제약으로 확정한다. 라우트는 23505를
 * 잡아 409로 응답 (votes 테이블과 동일 패턴).
 *
 * 인덱스 생성 전, 이미 존재할 수 있는 활성 중복 행을 정리:
 * 같은 (cafe_id, video_id)의 활성 행 중 가장 먼저 신청된 것만 남기고
 * 나머지는 rejected 처리 (삭제 대신 상태 변경 — 데이터 보존).
 *
 * 주의: recommendations.id는 UUID (001_initial.js — gen_random_uuid()).
 * Postgres는 uuid용 MIN/MAX 집계 함수를 제공하지 않아
 * "function min(uuid) does not exist"로 실패한다 (< 비교 연산자는
 * 있지만 집계 함수가 없음). ROW_NUMBER() OVER (... ORDER BY)는
 * 비교 연산자만 쓰므로 uuid에도 문제없다 — requested_at을 1차 기준으로,
 * 동시각 신청 시 id를 tie-breaker로 사용.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  await knex.raw(`
    UPDATE recommendations SET status = 'rejected'
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY cafe_id, video_id
          ORDER BY requested_at ASC, id ASC
        ) AS rn
        FROM recommendations
        WHERE status IN ('pending', 'accepted', 'playing')
      ) ranked
      WHERE rn > 1
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
