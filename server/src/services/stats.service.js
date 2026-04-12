const db = require('../db/knex');

async function getStats(cafeId) {
  const [total, played, skipped] = await Promise.all([
    db('recommendations').where({ cafe_id: cafeId }).count('id as n').first(),
    db('recommendations').where({ cafe_id: cafeId, status: 'played' }).count('id as n').first(),
    db('recommendations').where({ cafe_id: cafeId, status: 'skipped' }).count('id as n').first(),
  ]);

  const topSongs = await db('recommendations')
    .where({ cafe_id: cafeId, status: 'played' })
    .select('video_id', 'title', 'channel_title', 'thumbnail')
    .count('id as count')
    .groupBy('video_id', 'title', 'channel_title', 'thumbnail')
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
  const start = new Date(dateStr + 'T00:00:00.000Z');
  const end   = new Date(dateStr + 'T23:59:59.999Z');

  const recs = await db('recommendations')
    .where({ cafe_id: cafeId })
    .whereBetween('requested_at', [start, end])
    .orderBy('requested_at', 'asc');

  const byHour = Array(24).fill(null).map(() => []);
  for (const r of recs) byHour[new Date(r.requested_at).getHours()].push(r);

  return {
    date:    dateStr,
    total:   recs.length,
    played:  recs.filter(r => r.status === 'played').length,
    skipped: recs.filter(r => r.status === 'skipped').length,
    byHour,
  };
}

const TOP_PAGE_SIZE = 10;

async function getCafeTop10(cafeId, offset = 0) {
  const items = await db('recommendations')
    .where({ cafe_id: cafeId })
    .select('video_id', 'title', 'channel_title', 'thumbnail')
    .count('id as count')
    .sum('vote_count as total_votes')
    .groupBy('video_id', 'title', 'channel_title', 'thumbnail')
    .orderBy('count', 'desc')
    .limit(TOP_PAGE_SIZE + 1)
    .offset(offset);

  return { items: items.slice(0, TOP_PAGE_SIZE), hasMore: items.length > TOP_PAGE_SIZE };
}

async function getGlobalTop10(offset = 0) {
  const items = await db('recommendations')
    .select('video_id', 'title', 'channel_title', 'thumbnail')
    .count('id as count')
    .sum('vote_count as total_votes')
    .groupBy('video_id', 'title', 'channel_title', 'thumbnail')
    .orderBy('count', 'desc')
    .limit(TOP_PAGE_SIZE + 1)
    .offset(offset);

  return { items: items.slice(0, TOP_PAGE_SIZE), hasMore: items.length > TOP_PAGE_SIZE };
}

function since30Days() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d;
}

async function getHourlyPattern(cafeId) {
  const recs = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .select('requested_at');

  const counts = Array(24).fill(0);
  for (const r of recs) counts[new Date(r.requested_at).getHours()]++;
  return counts.map((count, hour) => ({ hour, count }));
}

async function getDayOfWeekPattern(cafeId) {
  const recs = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .select('requested_at');

  const counts = Array(7).fill(0);
  for (const r of recs) counts[new Date(r.requested_at).getDay()]++;
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
  // getHourlyPattern/getDayOfWeekPattern 과 동일하게 JS new Date().getDay() 기준
  const recs = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .select('video_id', 'title', 'channel_title', 'thumbnail', 'requested_at');

  const filtered = recs.filter(r => new Date(r.requested_at).getDay() === dayIndex);
  return groupAndPage(filtered, offset, limit);
}

async function getSongsByHour(cafeId, hour, offset = 0, limit = 10) {
  // getHourlyPattern 과 동일하게 JS new Date().getHours() 기준
  const recs = await db('recommendations')
    .where({ cafe_id: cafeId })
    .where('requested_at', '>=', since30Days())
    .select('video_id', 'title', 'channel_title', 'thumbnail', 'requested_at');

  const filtered = recs.filter(r => new Date(r.requested_at).getHours() === hour);
  return groupAndPage(filtered, offset, limit);
}

module.exports = { getStats, getDailyStats, getCafeTop10, getGlobalTop10, getHourlyPattern, getDayOfWeekPattern, getSongsByWeekday, getSongsByHour };
