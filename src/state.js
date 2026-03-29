// 서버 전체에서 공유하는 mutable 상태
const state = {
  queue: [],
  isSystemOn: true,
  isPlaying: false,
  extensionWs: null,
};

module.exports = state;
