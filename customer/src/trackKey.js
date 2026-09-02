// 곡을 식별하는 키. 좋아요가 신청 건이 아니라 곡에 붙으므로 화면과 서버가
// 같은 규칙으로 곡을 묶어야 한다.
//
// 서버의 canonicalizeVideoId / CANONICAL_VIDEO_ID_SQL과 같은 규칙이다.
// Spotify ?si=, YouTube &t= 같은 추적 파라미터 때문에 같은 곡이 서로 다른
// video_id로 저장돼 있어 '?' 앞부분만 쓴다. 한쪽만 바꾸면 화면에서는 눌린 것으로
// 보이는데 서버는 다른 곡으로 세는 어긋남이 생긴다.
export function trackKeyOf(videoId) {
  if (!videoId) return '';
  const q = videoId.indexOf('?');
  return q === -1 ? videoId : videoId.slice(0, q);
}
