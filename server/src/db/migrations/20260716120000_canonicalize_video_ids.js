/**
 * 기존 video_id 데이터 정규화 — 쓰기 시점 canonicalizeVideoId 도입에 따른 보정.
 *
 * 쓰기·조회가 정규화를 시작해도 DB에 이미 저장된 비정규 값('abc?si=xx')이
 * 남아 있으면: (1) 활성 큐의 비정규 행과 신규 정규 신청이 서로 다른 값이라
 * 중복 검사·unique index를 모두 통과해 같은 곡이 활성으로 2개 생기고,
 * (2) 곡 댓글도 기존 비정규 행이 정규화된 조회에서 빠진다.
 *
 * 순서가 중요하다: 활성 상태에는 (cafe_id, video_id) partial unique index가
 * 있어, 정규화 UPDATE 전에 "정규화하면 서로 충돌하게 될 활성 중복"을 먼저
 * 정리해야 한다. 같은 canonical 그룹에서 가장 이른 신청만 남기고 나머지는
 * skipped(터미널) 처리 — rejected(사장님 거절 의미)보다 중립적이다.
 *
 * id는 UUID이므로 MIN/MAX 대신 ROW_NUMBER를 쓴다(저장소 불변식).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async (knex) => {
  // knex.raw에서 ?는 바인딩 플레이스홀더로 해석되므로, SQL 리터럴로 쓰면
  // 안 되고 반드시 바인딩 배열로 전달한다 (song_comments.service와 동일 패턴).

  // 1) 정규화 후 활성 중복이 될 행을 먼저 종료 처리
  await knex.raw(`
    UPDATE recommendations SET status = 'skipped', played_at = now()
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY cafe_id, split_part(video_id, ?, 1)
                 ORDER BY requested_at, id
               ) AS rn
        FROM recommendations
        WHERE status IN ('pending', 'accepted', 'playing')
      ) ranked
      WHERE rn > 1
    )
  `, ['?']);

  // 2) 신청곡 video_id 정규화
  await knex.raw(`
    UPDATE recommendations
    SET video_id = split_part(video_id, ?, 1)
    WHERE video_id LIKE ?
  `, ['?', '%?%']);

  // 3) 곡 댓글 video_id 정규화 (곡별 묶음 기준이 video_id)
  await knex.raw(`
    UPDATE song_comments
    SET video_id = split_part(video_id, ?, 1)
    WHERE video_id LIKE ?
  `, ['?', '%?%']);
};

/**
 * 비가역 데이터 마이그레이션 — 제거된 쿼리스트링(?si=... 등)은 복원할 수
 * 없다. 정규화된 값은 신규 쓰기 규칙과 동일하므로 되돌릴 필요도 없다.
 *
 * @param {import('knex').Knex} knex
 */
exports.down = async () => {};
