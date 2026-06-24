const db = require('../db/knex');
const { kstStartOfDateString, kstEndOfDateString, kstStartOfDay, getKstHour } = require('../utils/kst');
const { canonicalizeVideoId } = require('../utils/video-id');

// 통계 쿼리의 KST 시/요일 분류를 SQL 로 내릴 때 쓰는 표현식.
// JS 의 new Date(t + 9h).getUTCHours()/getUTCDay() 산술을 그대로 복제:
//   (requested_at AT TIME ZONE 'UTC') + INTERVAL '9 hours' 의 hour / dow.
// → 808행 경계값 포함 동치 검증 완료 (JS getKstHour/getKstDay 와 모든 파티션 일치).
const SQL_KST_HOUR = `EXTRACT(HOUR FROM (requested_at AT TIME ZONE 'UTC') + INTERVAL '9 hours')`;
const SQL_KST_DOW  = `EXTRACT(DOW  FROM (requested_at AT TIME ZONE 'UTC') + INTERVAL '9 hours')`;

async function getStats(cafeId) {
  const [total, played, skipped] = await Promise.all([
    db('recommendations').where({ cafe_id: cafeId }).count('id as n').first(),
    db('recommendations').where({ cafe_id: cafeId, status: 'played' }).count('id as n').first(),
    db('recommendations').where({ cafe_id: cafeId, status: 'skipped' }).count('id as n').first(),
  ]);

  const topSongs = await db('recommendations')
    .where({ cafe_id: cafeId, status: 'played' })
    .select('video_id')
    .select(db.raw('MAX(title) as title'))
    .select(db.raw('MAX(channel_title) as channel_title'))
    .select(db.raw('MAX(thumbnail) as thumbnail'))
    .count('id as count')
    .groupBy('video_id')
    .orderBy('count', 'desc')
    .limit(10);

  return {
    total:    parseInt(total.n),
    played:   parseInt(played.n),
    skipped:  parseInt(skipped.n),
    topSongs,
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
    played:  recs.filter(r => r.status === 'played').length,
    skipped: recs.filter(r => r.status === 'skipped').length,
    byHour,
  };
}

const TOP_PAGE_SIZE = 10;

// canonicalizeVideoId 는 ../utils/video-id 에서 import (write 시점과 규칙 공유).

// SQL로 1차 그룹 → JS에서 정규화 video_id로 2차 병합 (쿼리스트링 차이로 쪼개진 행 통합)
function mergeByCanonicalId(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = canonicalizeVideoId(r.video_id);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r, video_id: key, count: Number(r.count), total_votes: Number(r.total_votes || 0) });
    } else {
      existing.count += Number(r.count);
      existing.total_votes += Number(r.total_votes || 0);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

async function getCafeTop10(cafeId, offset = 0) {
  const rows = await db('recommendations')
    .where({ cafe_id: cafeId })
    .select('video_id')
    .select(db.raw('MAX(title) as title'))
    .select(db.raw('MAX(channel_title) as channel_title'))
    .select(db.raw('MAX(thumbnail) as thumbnail'))
    .count('id as count')
    .sum('vote_count as total_votes')
    .groupBy('video_id');

  const merged = mergeByCanonicalId(rows);
  const paged  = merged.slice(offset, offset + TOP_PAGE_SIZE);
  return { items: paged, hasMore: merged.length > offset + TOP_PAGE_SIZE };
}

async function getGlobalTop10(offset = 0) {
  const rows = await db('recommendations')
    .select('video_id')
    .select(db.raw('MAX(title) as title'))
    .select(db.raw('MAX(channel_title) as channel_title'))
    .select(db.raw('MAX(thumbnail) as thumbnail'))
    .count('id as count')
    .sum('vote_count as total_votes')
    .groupBy('video_id');

  const merged = mergeByCanonicalId(rows);
  const paged  = merged.slice(offset, offset + TOP_PAGE_SIZE);
  return { items: paged, hasMore: merged.length > offset + TOP_PAGE_SIZE };
}

// 최근 30일 시작점 (KST 기준 30일 전 자정)
function since30Days() {
  return kstStartOfDay(30);
}

async function getHourlyPattern(cafeId) {
  const rows = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .select(db.raw(`${SQL_KST_HOUR}::int AS hour`))
    .count('id as count')
    .groupByRaw('1');

  const counts = Array(24).fill(0);
  for (const r of rows) counts[Number(r.hour)] = Number(r.count);
  return counts.map((count, hour) => ({ hour, count }));
}

async function getDayOfWeekPattern(cafeId) {
  const rows = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .select(db.raw(`${SQL_KST_DOW}::int AS dow`))
    .count('id as count')
    .groupByRaw('1');

  const counts = Array(7).fill(0);
  for (const r of rows) counts[Number(r.dow)] = Number(r.count);
  const labels = ['일', '월', '화', '수', '목', '금', '토'];
  return counts.map((count, i) => ({ day: labels[i], count }));
}

function groupAndPage(recs, offset, limit) {
  // video_id 기준 그룹핑 (바 차트와 동일한 JS 타임존 기준으로 필터된 결과를 받음)
  const map = new Map();
  for (const r of recs) {
    if (map.has(r.video_id)) {
      map.get(r.video_id).count++;
    } else {
      map.set(r.video_id, { video_id: r.video_id, title: r.title, channel_title: r.channel_title, thumbnail: r.thumbnail, count: 1 });
    }
  }
  const sorted = [...map.values()].sort((a, b) => b.count - a.count);
  return { items: sorted.slice(offset, offset + limit), hasMore: sorted.length > offset + limit };
}

async function getSongsByWeekday(cafeId, dayIndex, offset = 0, limit = 10) {
  const recs = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .whereRaw(`${SQL_KST_DOW}::int = ?`, [dayIndex])
    .select('video_id', 'title', 'channel_title', 'thumbnail', 'requested_at');

  return groupAndPage(recs, offset, limit);
}

async function getSongsByHour(cafeId, hour, offset = 0, limit = 10) {
  const recs = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .whereRaw(`${SQL_KST_HOUR}::int = ?`, [hour])
    .select('video_id', 'title', 'channel_title', 'thumbnail', 'requested_at');

  return groupAndPage(recs, offset, limit);
}

module.exports = { getStats, getDailyStats, getCafeTop10, getGlobalTop10, getHourlyPattern, getDayOfWeekPattern, getSongsByWeekday, getSongsByHour };
