// 수집 소스. 워커가 이 값을 보고 어디서 곡 목록을 가져올지 정한다.
// SoundCloud는 빠져 있다. 국가별 인기 차트 API가 죽어(모든 변형 400·404) 순위로
// 긁을 경로가 없다. 검색은 동작하지만 검색어가 걸어 놓은 한계가 곧 소스의 한계가
// 되어 "그 플랫폼의 인기곡"이 되지 않는다. 실측 기록은 docs/ROADMAP.md에 있다.
const DISCOVERY_SOURCES = Object.freeze(['apple_kr', 'musicbrainz_kr']);
// 날짜 창으로 진도를 잡는 소스. 순위 offset이 의미 없다.
const DATE_WINDOW_SOURCES = Object.freeze(['musicbrainz_kr']);
const DISCOVERY_WINDOW_DAYS = 7;
// 백필 하한. 더 내려가면 "최신곡"이라 부르기 어렵고 분석 예산만 쓴다.
const DISCOVERY_BACKFILL_DAYS = 365;
const DISCOVERY_MAX_LIMIT = 50;
const DISCOVERY_LEASE_MINUTES = 20;
const DISCOVERY_MAX_ATTEMPTS = 3;

module.exports = {
  DISCOVERY_SOURCES, DISCOVERY_MAX_LIMIT, DISCOVERY_LEASE_MINUTES, DISCOVERY_MAX_ATTEMPTS,
  DATE_WINDOW_SOURCES, DISCOVERY_WINDOW_DAYS, DISCOVERY_BACKFILL_DAYS,
};
