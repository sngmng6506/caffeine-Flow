const db = require('../db/knex');
const { kstStartOfDateString, kstEndOfDateString, kstStartOfDay, getKstHour } = require('../utils/kst');
const { REC_STATUS } = require('../constants/recommendation-status');
const { FILTER_STATUS, FILTER_REJECT_STATUSES } = require('../constants/music-filter-status');
const { MUSIC_FILTER_STATS_LOOKBACK_DAYS, STATS_PATTERN_LOOKBACK_DAYS } = require('../constants/time-policy');
const { CANONICAL_VIDEO_ID_SQL, KST_HOUR_SQL, KST_DOW_SQL } = require('../db/sql-fragments');
const { ownerRecommendation } = require('../utils/public-response');

async function getStats(cafeId) {
  const [total, played, skipped] = await Promise.all([
    db('recommendations').where({ cafe_id: cafeId }).count('id as n').first(),
    db('recommendations').where({ cafe_id: cafeId, status: REC_STATUS.PLAYED }).count('id as n').first(),
    db('recommendations').where({ cafe_id: cafeId, status: REC_STATUS.SKIPPED }).count('id as n').first(),
  ]);

  const topSongs = await db('recommendations')
    .where({ cafe_id: cafeId, status: REC_STATUS.PLAYED })
    .select(db.raw(`${CANONICAL_VIDEO_ID_SQL} as video_id`))
    .select(db.raw('MAX(title) as title'))
    .select(db.raw('MAX(channel_title) as channel_title'))
    .select(db.raw('MAX(thumbnail) as thumbnail'))
    .count('id as count')
    .groupBy(db.raw(CANONICAL_VIDEO_ID_SQL))
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
  for (const r of recs) byHour[getKstHour(new Date(r.requested_at))].push(ownerRecommendation(r));

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
// 좋아요는 votes에서 직접 센다. recommendations.vote_count는 큐 정렬을 위해
// 비정규화해 둔 값이라 같은 카페·같은 곡의 행들이 모두 같은 값을 갖는다 —
// 그대로 SUM 하면 신청 횟수만큼 곱해진다. 또 전체 TOP에는 우리 매장에서 재생된
// 적 없는 곡도 나오는데, 그런 곡의 표는 recommendations 어디에도 없다.
// voteScope: 표를 셀 범위 (매장 TOP은 그 카페, 전체 TOP은 전부)
function topQuery(builder, offset, sort = 'count', voteScope = () => {}) {
  const primary = sort === 'votes' ? 'total_votes' : 'count';
  const secondary = sort === 'votes' ? 'count' : 'total_votes';
  const played = builder
    .where({ status: REC_STATUS.PLAYED })
    .select(db.raw(`${CANONICAL_VIDEO_ID_SQL} as video_id`))
    .select(db.raw('MAX(title) as title'))
    .select(db.raw('MAX(channel_title) as channel_title'))
    .select(db.raw('MAX(thumbnail) as thumbnail'))
    .count('id as count')
    .groupBy(db.raw(CANONICAL_VIDEO_ID_SQL));

  const votes = db('votes')
    .select('track_key')
    .count('id as total_votes')
    .groupBy('track_key')
    .modify(voteScope);

  return db
    .select('p.video_id', 'p.title', 'p.channel_title', 'p.thumbnail')
    .select(db.raw('p.count as count'))
    .select(db.raw('COALESCE(v.total_votes, 0) as total_votes'))
    .from(played.as('p'))
    .leftJoin(votes.as('v'), 'v.track_key', 'p.video_id')
    .orderBy(primary, 'desc')
    .orderBy(secondary, 'desc')
    .orderBy('video_id', 'asc')
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

async function getCafeTop10(cafeId, offset = 0, sort = 'count') {
  const rows = await topQuery(
    db('recommendations').where({ cafe_id: cafeId }),
    offset,
    sort,
    q => q.where({ cafe_id: cafeId }),
  );
  return pageRows(rows);
}

async function getGlobalTop10(offset = 0, sort = 'count') {
  // 정지(is_suspended) 카페의 곡은 공개 TOP10에서 제외한다 — 정지의 목적이
  // 손님 노출 차단인데 여기만 남으면 구멍. join 대신 whereIn 서브쿼리를
  // 쓰는 이유: topQuery가 count('id')를 쓰므로 join 시 id가 모호해짐.
  const suspendedFree = () => db('cafes').select('id').where({ is_suspended: false });
  const rows = await topQuery(
    db('recommendations').whereIn('cafe_id', suspendedFree()),
    offset,
    sort,
    q => q.whereIn('cafe_id', suspendedFree()),
  );
  return pageRows(rows);
}

// 최근 30일 시작점 (기존 동작 유지: KST 기준 30일 전 자정)
function since30Days() {
  return kstStartOfDay(STATS_PATTERN_LOOKBACK_DAYS);
}

// 최근 7일 시작점 (KST 기준 6일 전 자정 — 오늘 포함 7일)
function since7Days() {
  return kstStartOfDay(MUSIC_FILTER_STATS_LOOKBACK_DAYS);
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
    .select(db.raw(`${CANONICAL_VIDEO_ID_SQL} as video_id`))
    .select(db.raw('MAX(title) as title'))
    .select(db.raw('MAX(channel_title) as channel_title'))
    .select(db.raw('MAX(thumbnail) as thumbnail'))
    .count('id as count')
    .groupBy(db.raw(CANONICAL_VIDEO_ID_SQL))
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
