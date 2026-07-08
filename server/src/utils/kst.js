// 모든 통계의 시간 경계를 한국 시간(KST, UTC+9) 기준으로 통일
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// "2026-04-25" 같은 날짜 문자열 → KST 자정 (UTC Date 객체로 반환)
function kstStartOfDateString(dateStr) {
  return new Date(`${dateStr}T00:00:00.000+09:00`);
}

function kstEndOfDateString(dateStr) {
  return new Date(`${dateStr}T23:59:59.999+09:00`);
}

// 오늘로부터 N일 전 KST 자정 (UTC Date)
function kstStartOfDay(daysAgo = 0) {
  const todayKstMs = Math.floor((Date.now() + KST_OFFSET_MS) / 86400000) * 86400000;
  return new Date(todayKstMs - daysAgo * 86400000 - KST_OFFSET_MS);
}

// UTC Date → 그 시점의 KST 시(0~23)
function getKstHour(date) {
  return new Date(date.getTime() + KST_OFFSET_MS).getUTCHours();
}

// 현재 시각의 KST 기준 날짜 문자열 (YYYY-MM-DD)
function kstTodayString(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

module.exports = {
  kstTodayString,
  kstStartOfDateString,
  kstEndOfDateString,
  kstStartOfDay,
  getKstHour,
};
