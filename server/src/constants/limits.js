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
const VISITOR_ID_MAX_LENGTH = 64;

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

module.exports = {
  ONE_MINUTE_MS,
  GLOBAL_API_RATE_LIMIT,
  QUEUE_MAX_SIZE,
  VISITOR_ID_MAX_LENGTH,
  RECOMMENDATION_REQUEST_LIMIT,
  VOTE_LIMIT,
  COMMENT_LIMIT,
};
