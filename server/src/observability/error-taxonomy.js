/**
 * 에러 분류 기준. 알림을 보낼지 말지는 전적으로 이 파일이 정한다.
 *
 * 핵심 구분은 심각도가 아니라 **원인 주체**다. 손님이 잘못된 링크를 넣어서
 * 나는 에러와 우리 키가 만료돼서 나는 에러는 같은 로그 레벨이어도 대응이
 * 완전히 다르다. 전자를 알림에 태우면 채널이 하루 만에 죽고, 그러면 후자도
 * 못 보게 된다.
 */

const CAUSE = Object.freeze({
  // 손님·사장님 입력 탓. 정상 운영 중에도 계속 발생하므로 절대 알리지 않는다.
  USER: 'user',
  // 외부 플랫폼·LLM 탓. 산발적이면 정상, 몰리면 장애 신호라 임계값으로 판단한다.
  EXTERNAL: 'external',
  // 우리 코드·설정 탓. 기본적으로 임계값을 쓰되 아래 IMMEDIATE는 1건도 즉시 알린다.
  PLATFORM: 'platform',
});

const CAUSES = Object.freeze(Object.values(CAUSE));

/**
 * 1건만 발생해도 즉시 알릴 코드.
 *
 * 공통점은 "이미 서비스가 멈춰 있다"는 것이다. 임계값을 기다리는 동안
 * 손님은 계속 신청에 실패한다.
 */
const IMMEDIATE_CODES = Object.freeze([
  'LLM_API_KEY_MISSING', // 키 미설정 — 전 카페 신청 차단
  'LLM_HTTP_401', //        인증 실패 — 키 만료·폐기
  'LLM_HTTP_402', //        크레딧 소진 — 결제 필요
  'LLM_HTTP_403', //        권한 거부 — 모델 접근 차단
  'DB_CONNECTION_FAILED', // DB 연결 불가 — 서비스 전체 정지
  'UNCAUGHT_EXCEPTION', //  프로세스 사망
  'UNHANDLED_REJECTION', // 처리되지 않은 Promise 거부
]);

const ALERT_TIER = Object.freeze({
  IMMEDIATE: 'immediate',
  THRESHOLD: 'threshold',
  LOG_ONLY: 'log_only',
});

// 임계값 판단 창. 이 시간 안에 threshold 건이 모이면 알린다.
const ALERT_WINDOW_MS = 5 * 60 * 1000;

// 같은 코드로 다시 알리기까지의 최소 간격. 없으면 DB가 죽었을 때
// 요청마다 웹훅이 나가 채널이 마비된다.
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

// 창과 임계값은 함께 "최소 발생률"을 정한다. 창이 미끄러지며 오래된 이벤트를
// 버리므로, 이 비율을 못 넘는 에러는 아무리 오래 이어져도 알림이 나가지 않는다.
//
// 이 서비스는 신청량이 많지 않아 높은 임계값이 곧 "영영 안 울림"이 된다.
// 예를 들어 5건/5분(분당 1건)은 하루 200건 규모에서 LLM이 완전히 죽어도
// 도달하지 못한다. 그래서 임계값 대신 쿨다운으로 소음을 막는다.
// 종류별 첫 발생은 바로 알리고, 같은 코드는 쿨다운 동안 잠잠하게 둔다.
const DEFAULT_THRESHOLD = 1;

// 코드별 임계값 예외. 특정 코드만 반복 확인이 필요할 때 여기에 둔다.
// (예: 산발적 타임아웃이 잦아 소음이 되면 LLM_TIMEOUT: 3)
const CODE_THRESHOLDS = Object.freeze({});

function alertTierFor({ cause, code }) {
  if (cause === CAUSE.USER) return ALERT_TIER.LOG_ONLY;
  if (IMMEDIATE_CODES.includes(code)) return ALERT_TIER.IMMEDIATE;
  return ALERT_TIER.THRESHOLD;
}

function thresholdFor(code) {
  return CODE_THRESHOLDS[code] || DEFAULT_THRESHOLD;
}

/**
 * DB 연결 실패는 knex/pg가 던지는 코드로만 알 수 있다. 일반 500과 섞이면
 * 임계값을 기다리다 늦게 알게 되므로 별도 코드로 승격한다.
 */
const DB_CONNECTION_ERROR_CODES = Object.freeze([
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH',
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
]);

function isDbConnectionError(error) {
  return DB_CONNECTION_ERROR_CODES.includes(error?.code);
}

/**
 * 트랙 메타데이터 조회 실패의 원인 주체를 가른다.
 *
 * 이 엔드포인트는 공개·무인증이라 손님이 오타를 내거나 비공개 곡을 붙여넣는
 * 것만으로도 하루에 수십 번 실패한다. 그걸 전부 알리면 채널이 죽고, 반대로
 * 전부 묻으면 SoundCloud가 HTML 구조를 바꾼 것 같은 진짜 신호를 놓친다.
 *
 * 판단 근거는 HTTP status가 아니라 에러에 실린 upstream 표식이다.
 * `getTrackMetadata`가 던지는 건 status=400인 자체 에러라, axios의
 * `error.response`를 보면 항상 undefined가 나와 전부 외부 장애로 분류된다.
 */
function trackErrorCause(error) {
  // 외부 호출 전에 입력 검증에서 걸린 경우 — 잘못된 URL, 미지원 플랫폼 등
  if (!error?.upstream) return CAUSE.USER;
  // 곡이 비공개이거나 삭제됨 — 손님이 고를 수 있는 정상 범위
  if (error.upstreamStatus === 404 || error.upstreamStatus === 410) return CAUSE.USER;
  // 403 차단, 429 한도 초과, 5xx, 네트워크 오류, 페이지 구조 변경
  return CAUSE.EXTERNAL;
}

module.exports = {
  CAUSE,
  CAUSES,
  ALERT_TIER,
  IMMEDIATE_CODES,
  ALERT_WINDOW_MS,
  ALERT_COOLDOWN_MS,
  DEFAULT_THRESHOLD,
  CODE_THRESHOLDS,
  alertTierFor,
  thresholdFor,
  isDbConnectionError,
  trackErrorCause,
};
