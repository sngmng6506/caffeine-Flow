// 손님이 어떤 곡에 좋아요를 눌렀는지 기억한다.
//
// 서버는 (카페, 곡, 방문자)당 한 표만 받는다. 화면의 눌림 표시도 같은 단위여야
// 하므로 신청곡 ID가 아니라 곡 키로 저장한다. 큐·최근 재생·TOP이 같은 곡을
// 서로 다른 행으로 보여줘도 눌림 상태는 하나다.
const KEY = (slug) => `cf_voted_song_${slug}`;

function read(slug) {
  try {
    const value = JSON.parse(localStorage.getItem(KEY(slug)) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function write(slug, list) {
  try { localStorage.setItem(KEY(slug), JSON.stringify(list)); } catch { /* 저장 실패는 표시에만 영향 */ }
}

export function hasVoted(slug, trackKey) {
  return Boolean(trackKey) && read(slug).includes(trackKey);
}

export function markVoted(slug, trackKey) {
  if (!trackKey) return;
  const list = read(slug);
  if (!list.includes(trackKey)) write(slug, [...list, trackKey]);
}

export function removeVote(slug, trackKey) {
  if (!trackKey) return;
  write(slug, read(slug).filter(key => key !== trackKey));
}
