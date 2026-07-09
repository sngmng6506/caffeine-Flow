const db = require('../db/knex');
const { kstStartOfDateString, kstEndOfDateString, kstStartOfDay, getKstHour } = require('../utils/kst');
const { REC_STATUS } = require('../constants/recommendation-status');
const { FILTER_STATUS, FILTER_REJECT_STATUSES } = require('../constants/music-filter-status');

// KST 기준 시간 필드 추출 SQL — 모든 통계의 타임존 기준을 Postgres 단에서 통일
const KST_HOUR_SQL = `date_part('hour', requested_at AT TIME ZONE 'Asia/Seoul')::int`;
const KST_DOW_SQL  = `date_part('dow',  requested_at AT TIME ZONE 'Asia/Seoul')::int`;

// Spotify ?si=, YouTube &t= 등 추적 파라미터로 같은 곡이 여러 video_id로
// 저장된 과거 데이터 병합용 — '?' 앞부분을 정규 ID로 사용.
// knex.raw는 문자열 리터럴 안의 ?도 바인딩 자리로 해석하므로 chr(63)을 사용해
// placeholder가 생기지 않게 한다. SELECT와 GROUP BY 표현식이 완전히 같아야 함.
const CANONICAL_ID_SQL = `split_part(video_id, chr(63), 1)`;

async function getStats(cafeId) {
  const [total, played, skipped] = await Promise.all([
    db('recommendations').where({ cafe_id: cafeId }).count('id as n').first(),
    db('recommendations').where({ cafe_id: cafeId, status: REC_STATUS.PLAYED }).count('id as n').first(),
    db('recommendations').where({ cafe_id: cafeId, status: REC_STATUS.SKIPPED }).count('id as n').first(),
  ]);

  const topSongs = await db('recommendations')
    .where({ cafe_id: cafeId, status: REC_STATUS.PLAYED })
    .select(db.raw(`${CANONICAL_ID_SQL} as video_id`))
    .select(db.raw('MAX(title) as title'))
    .select(db.raw('MAX(channel_title) as channel_title'))
    .select(db.raw('MAX(thumbnail) as thumbnail'))
    .count('id as count')
    .groupBy(db.raw(CANONICAL_ID_SQL))
    .orderBy('count', 'desc')
    .limit(10);

  return {
    total:    parseInt(total.n),
    played:   parseInt(played.n),
    skipped:  parseInt(skipped.n),
    topSongs: topSongs.map(r => ({ ...r, count: Number(r.count) })),
  };
}

async function getDailyStats(cafeId, dateStr) {
  const start = kstStartOfDateString(dateStr);
  const end   = kstEndOfDateString(dateStr);

  const recs = await db('recommendations')
    .where({ cafe_id: cafeId })
    .whereBetween('requested_at', [start, end])
    .orderBy('requested_at', 'asc');

  const byHour = Array(24).fill(null).map(() => []);
  for (const r of recs) byHour[getKstHour(new Date(r.requested_at))].push(r);

  return {
    date:    dateStr,
    total:   recs.length,
    played:  recs.filter(r => r.status === REC_STATUS.PLAYED).length,
    skipped: recs.filter(r => r.status === REC_STATUS.SKIPPED).length,
    byHour,
  };
}

const TOP_PAGE_SIZE = 10;

// 정규화 video_id 기준 SQL 그룹 집계 + limit+1 페이지네이션.
// 이전 구현은 전체 그룹 행을 메모리에 올려 JS에서 병합·정렬·slice —
// 무인증 공개 엔드포인트(/api/v1/top10)라 데이터 누적 시 요청당 풀스캔이었음.
function topQuery(builder, offset) {
  return builder
    .select(db.raw(`${CANONICAL_ID_SQL} as video_id`))
    .select(db.raw('MAX(title) as title'))
    .select(db.raw('MAX(channel_title) as channel_title'))
    .select(db.raw('MAX(thumbnail) as thumbnail'))
    .count('id as count')
    .sum('vote_count as total_votes')
    .groupBy(db.raw(CANONICAL_ID_SQL))
    .orderBy('count', 'desc')
    .limit(TOP_PAGE_SIZE + 1)
    .offset(offset);
}

function pageRows(rows) {
  const items = rows.slice(0, TOP_PAGE_SIZE).map(r => ({
    ...r,
    count:       Number(r.count),
    total_votes: Number(r.total_votes || 0),
  }));
  return { items, hasMore: rows.length > TOP_PAGE_SIZE };
}

async function getCafeTop10(cafeId, offset = 0) {
  const rows = await topQuery(db('recommendations').where({ cafe_id: cafeId }), offset);
  return pageRows(rows);
}

async function getGlobalTop10(offset = 0) {
  const rows = await topQuery(db('recommendations'), offset);
  return pageRows(rows);
}

// 최근 30일 시작점 (KST 기준 30일 전 자정)
function since30Days() {
  return kstStartOfDay(30);
}

// 최근 7일 시작점 (KST 기준 6일 전 자정 — 오늘 포함 7일)
function since7Days() {
  return kstStartOfDay(6);
}

async function getMusicFilterStats(cafeId) {
  const since = since7Days();

  const rows = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since)
    .select('filter_status')
    .count('id as count')
    .groupBy('filter_status');

  const byStatus = Object.fromEntries(rows.map(r => [r.filter_status || FILTER_STATUS.SKIPPED, Number(r.count)]));
  const accepted = byStatus[FILTER_STATUS.ACCEPTED] || 0;
  const rejected = byStatus[FILTER_STATUS.REJECTED] || 0;
  const errorRejected = byStatus[FILTER_STATUS.ERROR_REJECTED] || 0;
  const skipped = byStatus[FILTER_STATUS.SKIPPED] || 0;
  const processed = accepted + rejected + errorRejected;
  const safeRate = n => processed > 0 ? Number((n / processed).toFixed(3)) : 0;

  const recentRejections = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since)
    .whereIn('filter_status', FILTER_REJECT_STATUSES)
    .select('id', 'title', 'channel_title', 'thumbnail', 'platform', 'filter_status', 'filter_reason', 'filter_error_code', 'requested_at')
    .orderBy('requested_at', 'desc')
    .limit(8);

  const recentErrors = recentRejections
    .filter(r => r.filter_status === FILTER_STATUS.ERROR_REJECTED)
    .slice(0, 5)
    .map(r => ({
      id: r.id,
      title: r.title,
      platform: r.platform,
      filterErrorCode: r.filter_error_code,
      filterReason: r.filter_reason,
      requestedAt: r.requested_at,
    }));

  return {
    range: 'last_7_days',
    since,
    processed,
    accepted,
    rejected,
    errorRejected,
    skipped,
    acceptRate: safeRate(accepted),
    rejectRate: safeRate(rejected),
    errorRate: safeRate(errorRejected),
    recentRejections: recentRejections.map(r => ({
      id: r.id,
      title: r.title,
      channelTitle: r.channel_title,
      thumbnail: r.thumbnail,
      platform: r.platform,
      filterStatus: r.filter_status,
      filterReason: r.filter_reason,
      filterErrorCode: r.filter_error_code,
      requestedAt: r.requested_at,
    })),
    recentErrors,
  };
}

async function getHourlyPattern(cafeId) {
  const rows = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .select(db.raw(`${KST_HOUR_SQL} as hour`))
    .count('id as count')
    .groupBy(db.raw(KST_HOUR_SQL));

  const counts = Array(24).fill(0);
  for (const r of rows) counts[r.hour] = Number(r.count);
  return counts.map((count, hour) => ({ hour, count }));
}

async function getDayOfWeekPattern(cafeId) {
  const rows = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .select(db.raw(`${KST_DOW_SQL} as dow`))
    .count('id as count')
    .groupBy(db.raw(KST_DOW_SQL));

  const counts = Array(7).fill(0);
  for (const r of rows) counts[r.dow] = Number(r.count);
  const labels = ['일', '월', '화', '수', '목', '금', '토'];
  return counts.map((count, i) => ({ day: labels[i], count }));
}

// 특정 시간대/요일의 신청곡 그룹 집계 — 바 차트(위 패턴 함수)와 동일한
// KST SQL 기준을 공유하므로 클릭한 막대와 목록이 항상 일치
async function songsByKstField(cafeId, fieldSql, value, offset, limit) {
  const rows = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .whereRaw(`${fieldSql} = ?`, [value])
    .select(db.raw(`${CANONICAL_ID_SQL} as video_id`))
    .select(db.raw('MAX(title) as title'))
    .select(db.raw('MAX(channel_title) as channel_title'))
    .select(db.raw('MAX(thumbnail) as thumbnail'))
    .count('id as count')
    .groupBy(db.raw(CANONICAL_ID_SQL))
    .orderBy('count', 'desc')
    .limit(limit + 1)
    .offset(offset);

  const items = rows.slice(0, limit).map(r => ({ ...r, count: Number(r.count) }));
  return { items, hasMore: rows.length > limit };
}

async function getSongsByWeekday(cafeId, dayIndex, offset = 0, limit = 10) {
  return songsByKstField(cafeId, KST_DOW_SQL, dayIndex, offset, limit);
}

async function getSongsByHour(cafeId, hour, offset = 0, limit = 10) {
  return songsByKstField(cafeId, KST_HOUR_SQL, hour, offset, limit);
}

module.exports = {
  getStats,
  getDailyStats,
  getCafeTop10,
  getGlobalTop10,
  getHourlyPattern,
  getDayOfWeekPattern,
  getMusicFilterStats,
  getSongsByWeekday,
  getSongsByHour,
};
