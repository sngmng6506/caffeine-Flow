// 곡을 가리키는 값 — 이 저장소에서 "같은 곡"의 정의.
//
// 곡 참조: 그 곡을 다시 열 수 있는 값. DB 칸 이름은 역사적으로 video_id지만
// 영상 ID가 아닐 수 있다. YouTube는 11자 영상 ID, SoundCloud·Spotify는 정규화한
// 전체 URL이다(track-metadata.service가 만든다). Electron이 이 값으로 곡을 열고
// 손님 화면이 이 값으로 곡 링크를 만든다. 칸 이름만 보고 영상 ID를 지어 넣으면
// 링크가 형식만 맞는 가짜 주소가 된다(데모 시드에서 실제로 있었다).
//
// 곡 키(track_key): 같은 곡을 하나로 묶는 값. 곡 참조에서 '?' 앞부분이다.
// Spotify ?si=, YouTube &t= 같은 추적 파라미터 때문에 같은 곡이 다른 참조로
// 들어오기 때문이다. 좋아요·TOP 집계·곡 댓글·음향 분석·곡 라벨이 이 키로 곡을
// 센다. 저장하는 쪽은 쓰기 전에 이 함수를 거치고, 그 전에 쌓인 값은
// 20260716120000 마이그레이션이 보정했다. 그래서 저장된 video_id는 곧 곡 키다.
// 읽기 SQL이 다시 자르는 것은 보정 밖 값에 대한 방어다.
//
// 플랫폼마다 참조 모양이 달라(영상 ID와 URL) 곡 키만으로도 플랫폼끼리 겹치지
// 않는다. 좋아요는 플랫폼 없이 곡 키로 묶고, 음향 분석은 (platform, track_key)로
// 묶는다.
//
// 같은 규칙이 세 곳에 있다 — 여기, SQL(db/sql-fragments의 TRACK_KEY_SQL),
// 손님 화면(customer/src/trackKey.js). 한쪽만 바꾸면 화면은 좋아요가 눌린 것으로
// 보이는데 서버는 다른 곡으로 센다. track-key-parity.test.mjs가 셋을 맞춰 본다.
function trackKeyOf(ref) {
  if (!ref) return ref;
  const q = ref.indexOf('?');
  return q === -1 ? ref : ref.substring(0, q);
}

module.exports = { trackKeyOf };
