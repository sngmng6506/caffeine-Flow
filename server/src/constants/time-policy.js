const TIMEZONE = 'Asia/Seoul';
const KST_OFFSET_HOURS = 9;
const MS_PER_DAY = 86_400_000;
const KST_OFFSET_MS = KST_OFFSET_HOURS * 60 * 60 * 1000;

const MUSIC_FILTER_STATS_LOOKBACK_DAYS = 6;
const RECENT_HISTORY_LOOKBACK_DAYS = 6;

// 기존 통계 패턴은 현재 동작을 유지하기 위해 30일 전 KST 자정부터 집계한다.
const STATS_PATTERN_LOOKBACK_DAYS = 30;

// 매장 생존 신호(last_heartbeat_at) 정책.
// REFRESH: owner 소켓 연결이 유지되는 동안 갱신하는 주기.
// ACTIVE_WINDOW: 운영자 모니터링에서 "지금 켜져 있음"으로 볼 유예 시간.
//   갱신 주기보다 넉넉히(2회 이상 유실 허용) 잡아, 일시적 네트워크 끊김이
//   곧바로 휴면으로 보이지 않게 한다.
const HEARTBEAT_REFRESH_MS = 2 * 60 * 1000;
const HEARTBEAT_ACTIVE_WINDOW_MS = 5 * 60 * 1000;
// Electron은 5초마다 재생 상태를 재전송한다. 두 번의 누락을 허용한 뒤 손님 화면을 초기화한다.
const PLAYBACK_STATE_TTL_MS = 15 * 1000;
// 재연결 중인 현재 재생 앱이 lease를 회수할 유예 시간. 이 시간이 지난
// 뒤에만 대기 중인 다른 Electron 앱을 재생 리더로 승격한다.
const PLAYBACK_LEADER_GRACE_MS = 15 * 1000;

module.exports = {
  TIMEZONE,
  KST_OFFSET_HOURS,
  MS_PER_DAY,
  KST_OFFSET_MS,
  MUSIC_FILTER_STATS_LOOKBACK_DAYS,
  RECENT_HISTORY_LOOKBACK_DAYS,
  STATS_PATTERN_LOOKBACK_DAYS,
  HEARTBEAT_REFRESH_MS,
  HEARTBEAT_ACTIVE_WINDOW_MS,
  PLAYBACK_STATE_TTL_MS,
  PLAYBACK_LEADER_GRACE_MS,
};
