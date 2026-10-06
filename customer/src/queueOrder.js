// 대기열에 곡을 보여 주는 순서. 좋아요가 많은 곡이 먼저, 같으면 먼저 신청한 곡이
// 먼저다.
//
// 서버의 getRecommendations(SQL ORDER BY)와 사장님 화면의 byPriority와 같은
// 규칙이다. 사장님 화면은 이 순서로 다음 곡을 실제로 고른다. 한쪽만 바꾸면 손님
// 화면에는 "1번째"로 보이는 곡이 실제로는 다른 순서로 재생된다.
export function byQueuePriority(a, b) {
  return b.vote_count - a.vote_count || new Date(a.requested_at) - new Date(b.requested_at);
}
