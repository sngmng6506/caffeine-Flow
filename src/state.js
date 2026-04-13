// 서버 전체에서 공유하는 mutable 상태
const state = {
  queue: [],
  isSystemOn: true,
  isPlaying: false,
  lastSongEndedAt: 0, // 중복 song_ended 방지용 전역 타임스탬프
};

module.exports = state;
