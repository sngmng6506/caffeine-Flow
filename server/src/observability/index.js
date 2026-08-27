const { ALERT_WEBHOOK_URL } = require('../config');
const { CAUSE, CAUSES, isDbConnectionError } = require('./error-taxonomy');
const { createAlertAggregator } = require('./alert-aggregator');
const { createAlertChannel } = require('./alert-channel');

const aggregator = createAlertAggregator();
const channel = createAlertChannel({ webhookUrl: ALERT_WEBHOOK_URL });

// 테스트 환경에서는 네트워크로 나가지 않는다. 웹훅 URL이 없어도 마찬가지다.
const alertsEnabled = channel.enabled && process.env.NODE_ENV !== 'test';

function normalizeCode(code, error) {
  if (code) return String(code).slice(0, 60);
  if (error?.code) return String(error.code).slice(0, 60);
  return 'UNKNOWN_ERROR';
}

function normalizeMessage(error, fallback) {
  const raw = error?.message || error?.response?.status || fallback || null;
  return raw ? String(raw).slice(0, 500) : null;
}

/**
 * 정규화된 에러 로그. 모든 서버 에러는 이 함수 하나를 거친다.
 *
 * 로그 한 줄에 항상 같은 필드가 같은 순서로 찍히므로 나중에 로그를 훑을 때
 * 원인 주체와 카페를 바로 가려낼 수 있다. 알림 여부는 error-taxonomy가
 * 정하며 호출부는 신경 쓰지 않는다.
 *
 * @param {object}  params
 * @param {string}  params.code   안정적인 에러 코드 (LLM_TIMEOUT 등)
 * @param {string}  params.cause  CAUSE.USER | EXTERNAL | PLATFORM
 * @param {object=} params.cafe   { id, slug } — 카페 범위가 있는 에러만
 * @param {string=} params.route  'POST /cafes/:slug/recommendations'
 * @param {Error=}  params.error  원본 에러 (스택은 로컬 로그에만 남는다)
 */
function logError({ code, cause, cafe = null, route = null, error = null, message = null }) {
  const resolvedCause = CAUSES.includes(cause) ? cause : CAUSE.PLATFORM;
  const resolvedCode = normalizeCode(code, error);
  const resolvedMessage = normalizeMessage(error, message);

  const parts = [
    `[error] code=${resolvedCode}`,
    `cause=${resolvedCause}`,
    cafe?.id ? `cafe=${cafe.id}` : null,
    cafe?.slug ? `slug=${cafe.slug}` : null,
    route ? `route=${route}` : null,
    resolvedMessage ? `msg=${resolvedMessage}` : null,
  ].filter(Boolean);
  console.error(parts.join(' '));
  // 스택은 외부로 보내지 않고 서버 로그에만 남긴다.
  if (error?.stack && resolvedCause === CAUSE.PLATFORM) console.error(error.stack);

  if (!alertsEnabled) return;
  const summary = aggregator.record({
    code: resolvedCode,
    cause: resolvedCause,
    cafeId: cafe?.id || null,
    slug: cafe?.slug || null,
    route,
    message: resolvedMessage,
  });
  if (summary) channel.deliver(summary);
}

module.exports = {
  logError,
  isDbConnectionError,
  alertsEnabled,
  CAUSE,
};
