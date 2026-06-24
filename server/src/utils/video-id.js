// video_id 정규화 — Spotify ?si=, YouTube &t= 등 추적 파라미터로 같은 곡이
// 서로 다른 video_id 로 저장되는 걸 막는다. 쿼리스트링(? 이후)을 제거.
//
// write 시점(recommendation.service: add/findActiveByVideoId)과
// read 시점(stats.service: mergeByCanonicalId)이 반드시 같은 규칙을 써야 하므로
// 한 곳에 두고 양쪽에서 import 한다.
function canonicalizeVideoId(id) {
  if (!id) return id;
  const q = id.indexOf('?');
  return q === -1 ? id : id.substring(0, q);
}

module.exports = { canonicalizeVideoId };
