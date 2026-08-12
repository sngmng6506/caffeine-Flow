const ONE_MINUTE_MS = 60_000;

// 전체 API 보호용 전역 한도. 익명 쓰기 API는 아래 dual limiter를 추가로 통과해야 한다.
const GLOBAL_API_RATE_LIMIT = Object.freeze({
  windowMs: ONE_MINUTE_MS,
  max: 120,
});

// 카페 신청 큐에 동시에 머물 수 있는 active 추천곡 수.
const QUEUE_MAX_SIZE = 30;

// visitor_id는 클라이언트 localStorage UUID라 위조 가능하지만, 같은 브라우저 UX 구분에 유용하다.
// 과도하게 긴 헤더는 저장·로깅·rate limit key 오염을 막기 위해 무시한다.
// DB visitor_id 컬럼 길이와 반드시 맞춘다. 더 긴 값을 통과시키면 쓰기 API가
// PostgreSQL varchar(36) 오류로 500을 반환한다.
const VISITOR_ID_MAX_LENGTH = 36;

const RECOMMENDATION_REQUEST_LIMIT = Object.freeze({
  windowMs: ONE_MINUTE_MS,
  visitorMax: 3,
  ipMax: 10,
});

const VOTE_LIMIT = Object.freeze({
  windowMs: ONE_MINUTE_MS,
  visitorMax: 15,
  ipMax: 40,
});

const COMMENT_LIMIT = Object.freeze({
  windowMs: ONE_MINUTE_MS,
  visitorMax: 5,
  ipMax: 15,
});

// offset 기반 공개 목록이 비정상적으로 깊은 DB 스캔을 만들지 않게 제한한다.
// 현재 데이터 규모에서는 10,000행이면 운영·분석용 탐색 범위로도 충분하다.
const MAX_PAGINATION_OFFSET = 10_000;
const COMMENT_PAGE_SIZE = 20;
const COMMENT_PAGE_MAX_SIZE = 50;

// 운영자 로그인은 단일 비밀번호 검증이라 무차별 대입에 그대로 노출된다.
// 정상 사용은 하루 몇 회 수준이므로 넉넉히 15분 10회로 묶는다.
const ADMIN_LOGIN_LIMIT = Object.freeze({
  windowMs: 15 * ONE_MINUTE_MS,
  max: 10,
});

module.exports = {
  ONE_MINUTE_MS,
  GLOBAL_API_RATE_LIMIT,
  QUEUE_MAX_SIZE,
  VISITOR_ID_MAX_LENGTH,
  RECOMMENDATION_REQUEST_LIMIT,
  VOTE_LIMIT,
  COMMENT_LIMIT,
  MAX_PAGINATION_OFFSET,
  COMMENT_PAGE_SIZE,
  COMMENT_PAGE_MAX_SIZE,
  ADMIN_LOGIN_LIMIT,
};
