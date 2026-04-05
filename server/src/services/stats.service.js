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

async function getCafeTop10(cafeId, limit = 10) {
  return db('recommendations')
    .where({ cafe_id: cafeId })
    .select('video_id', 'title', 'channel_title', 'thumbnail')
    .count('id as count')
    .sum('vote_count as total_votes')
    .groupBy('video_id', 'title', 'channel_title', 'thumbnail')
    .orderBy('count', 'desc')
    .limit(limit);
}

async function getGlobalTop10(limit = 10) {
  return db('recommendations')
    .select('video_id', 'title', 'channel_title', 'thumbnail')
    .count('id as count')
    .sum('vote_count as total_votes')
    .groupBy('video_id', 'title', 'channel_title', 'thumbnail')
    .orderBy('count', 'desc')
    .limit(limit);
}

module.exports = { getStats, getDailyStats, getCafeTop10, getGlobalTop10 };
