// recommendations.public.js와 recommendations.owner.js가 공유하는 유틸.
const MAX_QUEUE_SIZE = 30;

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
  return typeof v === 'string' && v.length <= 64 ? v : null;
}

// visitor_id + IP 이중 rate limiter 생성기 — 신청 라우트에서 검증된 패턴을
// 댓글·투표 등 다른 익명 쓰기 API에도 재사용하기 위한 팩토리.
// visitor_id는 위조 가능하므로 IP 한도가 최후 방어선 (신청 라우트 주석 참조).
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function makeDualLimiter({ windowMs = 60_000, visitorMax, ipMax, message }) {
  const msg = { error: message };
  return [
    rateLimit({
      windowMs,
      max: visitorMax,
      keyGenerator: (req) => req.headers['x-visitor-id'] || `ip:${ipKeyGenerator(req.ip)}`,
      message: msg,
    }),
    rateLimit({
      windowMs,
      max: ipMax,
      keyGenerator: (req) => ipKeyGenerator(req.ip),
      message: msg,
    }),
  ];
}

module.exports = { MAX_QUEUE_SIZE, broadcast, getClientIp, safeVisitorId, makeDualLimiter };
