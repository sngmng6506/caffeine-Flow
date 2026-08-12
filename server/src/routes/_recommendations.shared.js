// recommendations.public.js와 recommendations.owner.js가 공유하는 유틸.
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { ONE_MINUTE_MS, QUEUE_MAX_SIZE, VISITOR_ID_MAX_LENGTH } = require('../constants/limits');

function broadcast(req, slug, event, data) {
  req.app.get('io')?.of('/cafe').to(slug).emit(event, data);
}

// 클라이언트 IP는 반드시 req.ip 사용 — server.js에서 trust proxy 1을 설정했으므로
// Express가 Railway 프록시가 붙인 X-Forwarded-For의 마지막(신뢰 가능) 값을 반환한다.
// 헤더를 직접 파싱해 첫 값을 쓰면 클라이언트가 위조한 IP가 잡혀서
// 투표 UNIQUE 제약·rate limit·방문 통계 dedupe가 전부 우회 가능.
function getClientIp(req) {
  return req.ip;
}

// x-visitor-id 헤더 정규화 — 문자열이 아니거나 과도하게 길면 무시
function safeVisitorId(req) {
  const v = req.headers['x-visitor-id'];
  if (typeof v !== 'string') return null;
  const normalized = v.trim();
  return normalized && normalized.length <= VISITOR_ID_MAX_LENGTH ? normalized : null;
}

// visitor_id + IP 이중 rate limiter 생성기 — 신청 라우트에서 검증된 패턴을
// 댓글·투표 등 다른 익명 쓰기 API에도 재사용하기 위한 팩토리.
// visitor_id는 위조 가능하므로 IP 한도가 최후 방어선 (신청 라우트 주석 참조).

// NODE_ENV=test에서는 스킵 — 통합 테스트가 같은 IP(127.0.0.1)에서
// 연속 요청을 보내므로 한도에 걸려 시나리오 검증이 불가능해짐
const skipInTest = () => process.env.NODE_ENV === 'test';

function makeDualLimiter({ windowMs = ONE_MINUTE_MS, visitorMax, ipMax, message }) {
  const msg = { error: message };
  return [
    rateLimit({
      windowMs,
      max: visitorMax,
      keyGenerator: (req) => safeVisitorId(req) || `ip:${ipKeyGenerator(req.ip)}`,
      message: msg,
      skip: skipInTest,
    }),
    rateLimit({
      windowMs,
      max: ipMax,
      keyGenerator: (req) => ipKeyGenerator(req.ip),
      message: msg,
      skip: skipInTest,
    }),
  ];
}

module.exports = { MAX_QUEUE_SIZE: QUEUE_MAX_SIZE, QUEUE_MAX_SIZE, broadcast, getClientIp, safeVisitorId, makeDualLimiter };
