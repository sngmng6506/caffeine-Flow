const { ALERT_WEBHOOK_URL } = require('../config');
const { CAUSE, CAUSES, ALERT_TEST_CODE, isDbConnectionError, trackErrorCause, naverCallbackError } = require('./error-taxonomy');
const { createAlertAggregator } = require('./alert-aggregator');
const { createAlertChannel, SEND_TIMEOUT_MS } = require('./alert-channel');

// 크래시 뒤 종료를 미루는 시간. 웹훅 전송 타임아웃보다 길어야 마지막 알림이
// 잘리지 않는다. 두 값이 따로 놀지 않도록 여기서 파생시킨다.
const CRASH_EXIT_DELAY_MS = SEND_TIMEOUT_MS + 500;

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

/**
 * 운영자가 누르는 전송 확인. 실제 알림과 같은 경로(집계 → 채널 → 웹훅)를 타되
 * 결과를 기다려 돌려준다 — curl로 웹훅에 직접 쏘는 것과 달리 "서버가 실제로
 * 보낼 수 있는가"까지 확인된다. 웹훅 URL이 프로세스에 들어갔는지, 네트워크로
 * 나갈 수 있는지, 페이로드 생성이 정상인지가 한 번에 드러난다.
 *
 * 전용 코드를 써서 진짜 에러 코드의 쿨다운을 태우지 않는다.
 */
async function sendTestAlert({ route = 'POST /api/v1/admin/alert-test' } = {}) {
  if (!alertsEnabled) return { sent: false, reason: 'disabled' };

  const summary = aggregator.record({
    code: ALERT_TEST_CODE,
    cause: CAUSE.PLATFORM,
    route,
    message: '운영자 콘솔에서 보낸 전송 확인입니다. 실제 장애가 아닙니다.',
  });
  // 30분 쿨다운은 테스트 코드에도 그대로 적용된다. 예외를 두면 이 경로만
  // 실제 알림과 다르게 동작해 확인의 의미가 줄어든다.
  if (!summary) return { sent: false, reason: 'cooldown' };

  const delivered = await channel.deliver(summary);
  return { sent: delivered, reason: delivered ? null : 'delivery_failed' };
}

module.exports = {
  sendTestAlert,
  logError,
  CRASH_EXIT_DELAY_MS,
  isDbConnectionError,
  trackErrorCause,
  naverCallbackError,
  alertsEnabled,
  CAUSE,
};
