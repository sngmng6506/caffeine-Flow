const {
  DATE_WINDOW_SOURCES, DISCOVERY_WINDOW_DAYS, DISCOVERY_BACKFILL_DAYS,
} = require('../../constants/audio-discovery');

const DAY = 24 * 60 * 60 * 1000;
const iso = (date) => date.toISOString().slice(0, 10);
const shift = (value, days) => iso(new Date(new Date(`${value}T00:00:00Z`).getTime() + days * DAY));

function isDateWindowSource(source) {
  return DATE_WINDOW_SOURCES.includes(source);
}

/**
 * 다음에 훑을 날짜 구간을 정한다. 다 훑었으면 `null`.
 *
 * 최신 쪽 공백을 먼저 메운다. 한동안 버튼을 안 눌렀으면 그 사이에 나온 곡이 가장
 * 급하고, 상대적인 "며칠 전"으로 잡으면 그 구간이 통째로 빠지기 때문이다.
 * 최신을 다 따라잡은 뒤에야 과거로 내려가며, 하한에 닿으면 멈춘다.
 */
function nextWindow(cursor, today, days = DISCOVERY_WINDOW_DAYS, backfillDays = DISCOVERY_BACKFILL_DAYS) {
  const to = iso(today);
  const floor = shift(to, -backfillDays);
  if (!cursor?.covered_to || !cursor?.covered_from) {
    return { from: shift(to, -days), to, mode: 'fresh' };
  }
  const coveredTo = iso(new Date(cursor.covered_to));
  const coveredFrom = iso(new Date(cursor.covered_from));
  if (coveredTo < to) return { from: coveredTo, to, mode: 'fresh' };
  if (coveredFrom <= floor) return null;
  return { from: shift(coveredFrom, -days) < floor ? floor : shift(coveredFrom, -days),
    from_is_floor: shift(coveredFrom, -days) < floor, to: coveredFrom, mode: 'backfill' };
}

/** 이번에 훑은 구간을 반영한 다음 커서. */
function advance(cursor, window) {
  const coveredTo = cursor?.covered_to ? iso(new Date(cursor.covered_to)) : null;
  const coveredFrom = cursor?.covered_from ? iso(new Date(cursor.covered_from)) : null;
  if (window.mode === 'fresh') {
    return { covered_from: coveredFrom && coveredFrom < window.from ? coveredFrom : window.from,
      covered_to: window.to };
  }
  return { covered_from: window.from, covered_to: coveredTo || window.to };
}

module.exports = { isDateWindowSource, nextWindow, advance, iso, shift };
