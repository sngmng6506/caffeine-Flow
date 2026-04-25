const db = require('../db/knex');
const { kstStartOfDateString, kstEndOfDateString, kstStartOfDay, getKstHour, getKstDay } = require('../utils/kst');

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

// Spotify ?si=, YouTube &t= 등 추적 파라미터로 같은 곡이 여러 video_id로 저장된 과거 데이터 병합용
function canonicalizeVideoId(id) {
  if (!id) return id;
  const q = id.indexOf('?');
  return q === -1 ? id : id.substring(0, q);
}

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
  const recs = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .select('requested_at');

  const counts = Array(24).fill(0);
  for (const r of recs) counts[getKstHour(new Date(r.requested_at))]++;
  return counts.map((count, hour) => ({ hour, count }));
}

async function getDayOfWeekPattern(cafeId) {
  const recs = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .select('requested_at');

  const counts = Array(7).fill(0);
  for (const r of recs) counts[getKstDay(new Date(r.requested_at))]++;
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
    .select('video_id', 'title', 'channel_title', 'thumbnail', 'requested_at');

  const filtered = recs.filter(r => getKstDay(new Date(r.requested_at)) === dayIndex);
  return groupAndPage(filtered, offset, limit);
}

async function getSongsByHour(cafeId, hour, offset = 0, limit = 10) {
  const recs = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .select('video_id', 'title', 'channel_title', 'thumbnail', 'requested_at');

  const filtered = recs.filter(r => getKstHour(new Date(r.requested_at)) === hour);
  return groupAndPage(filtered, offset, limit);
}

module.exports = { getStats, getDailyStats, getCafeTop10, getGlobalTop10, getHourlyPattern, getDayOfWeekPattern, getSongsByWeekday, getSongsByHour };
