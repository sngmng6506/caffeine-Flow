// 수집 소스. 워커가 이 값을 보고 어디서 곡 목록을 가져올지 정한다.
//
// `apple_global`은 국가를 돌아가며 본다. Apple 피드는 국가 코드가 필수라 전 세계
// 통합 차트가 없다(`global`·`ww` 모두 500). 한 나라 100곡을 다 보면 다음 나라로
// 넘어가며, offset이 그 진도를 담는다.
//
// `soundcloud_trending`은 장르별 인기 플레이리스트를 돈다. 국가별 인기 차트 API는
// 죽었고(모든 변형 400·404) 지역 필터도 API에서 사라져, SoundCloud를 한국으로
// 한정할 방법이 없다. 대신 장르가 20개로 갈려 있어 장르 다양성을 채운다 —
// 나머지 두 소스가 모두 한국 대중음악이라 표본이 한쪽으로 쏠려 있었다.
// 실측 기록은 docs/ROADMAP.md에 있다.
const DISCOVERY_SOURCES = Object.freeze(['apple_global', 'musicbrainz_kr', 'soundcloud_trending']);
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
