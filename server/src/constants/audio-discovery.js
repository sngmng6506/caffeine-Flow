// 수집 소스. 워커가 이 값을 보고 어디서 곡 목록을 가져올지 정한다.
// `soundcloud`만 검색어를 받는다. 인기 차트 경로는 404라 쓸 수 없고, 애초에 차트에는
// 인디가 거의 안 잡혀 지역 신을 겨냥하는 목적에도 맞지 않는다(docs/ROADMAP.md).
const DISCOVERY_SOURCES = Object.freeze(['apple_kr', 'musicbrainz_kr', 'soundcloud']);
// 검색어를 받는 소스. 커서가 (source, query_key)라 검색어마다 진도가 따로 남는다.
const QUERY_SOURCES = Object.freeze(['soundcloud']);
// 날짜 창으로 진도를 잡는 소스. 순위 offset이 의미 없다.
const DATE_WINDOW_SOURCES = Object.freeze(['musicbrainz_kr']);
const DISCOVERY_WINDOW_DAYS = 7;
// 백필 하한. 더 내려가면 "최신곡"이라 부르기 어렵고 분석 예산만 쓴다.
const DISCOVERY_BACKFILL_DAYS = 365;
const DISCOVERY_MAX_LIMIT = 50;
const DISCOVERY_LEASE_MINUTES = 20;
const DISCOVERY_MAX_ATTEMPTS = 3;

module.exports = {
  DISCOVERY_SOURCES, QUERY_SOURCES, DISCOVERY_MAX_LIMIT, DISCOVERY_LEASE_MINUTES, DISCOVERY_MAX_ATTEMPTS,
  DATE_WINDOW_SOURCES, DISCOVERY_WINDOW_DAYS, DISCOVERY_BACKFILL_DAYS,
};
