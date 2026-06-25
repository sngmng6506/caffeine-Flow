const db = require('../db/knex');
const { kstStartOfDay } = require('../utils/kst');
const { canonicalizeVideoId } = require('../utils/video-id');

// 최근 7일: KST 기준 6일 전 00:00 ~ 오늘 23:59:59.999
function lastSevenDaysRange() {
  const start = kstStartOfDay(6);
  const end   = new Date(kstStartOfDay(0).getTime() + 86400000 - 1);
  return [start, end];
}

async function getRecommendations(cafeId) {
  return db('recommendations')
    .where({ cafe_id: cafeId })
    .whereBetween('requested_at', lastSevenDaysRange())
    .orderBy('vote_count', 'desc')
    .orderBy('requested_at', 'asc');
}

async function findById(id) {
  return db('recommendations').where({ id }).first();
}

async function findActiveByVideoId(cafeId, videoId) {
  return db('recommendations')
    .where({ cafe_id: cafeId, video_id: canonicalizeVideoId(videoId) })
    .whereIn('status', ['pending', 'accepted', 'playing'])
    .first();
}

async function countActive(cafeId) {
  const row = await db('recommendations')
    .where({ cafe_id: cafeId })
    .whereIn('status', ['pending', 'accepted', 'playing'])
    .count('id as n')
    .first();
  return parseInt(row.n);
}

async function add(cafeId, { videoId, title, channelTitle, thumbnail, duration, requesterIp, requesterName, platform = 'youtube', visitorId }) {
  const [rec] = await db('recommendations')
    .insert({
      cafe_id:        cafeId,
      video_id:       canonicalizeVideoId(videoId),
      title,
      channel_title:  channelTitle,
      thumbnail,
      duration,
      requester_ip:   requesterIp,
      requester_name: requesterName,
      platform,
      visitor_id:     visitorId || null,
    })
    .returning('*');
  return rec;
}

async function updateStatus(id, status) {
  const updates = { status };
  const now = new Date();

  if (status === 'playing') {
    updates.playing_started_at = now;
  }

  if (status === 'played' || status === 'skipped') {
    updates.played_at = now;
    // 재생 시작 시각이 있으면 재생 시간 계산
    const current = await db('recommendations').where({ id }).first();
    if (current?.playing_started_at) {
      updates.play_duration_seconds = Math.round((now - new Date(current.playing_started_at)) / 1000);
    }
  }

  const [rec] = await db('recommendations').where({ id }).update(updates).returning('*');
  return rec;
}

// playing으로 변경 전 기존 playing 곡을 played로 일괄 처리 (except 제외)
async function clearPlaying(cafeId, exceptId) {
  const now = new Date();
  let query = db('recommendations').where({ cafe_id: cafeId, status: 'playing' });
  if (exceptId) query = query.whereNot({ id: exceptId });

  // 각 곡의 재생 시간을 개별 계산
  const playingRecs = await query.clone().select('id', 'playing_started_at');
  const results = [];
  for (const r of playingRecs) {
    const updates = { status: 'played', played_at: now };
    if (r.playing_started_at) {
      updates.play_duration_seconds = Math.round((now - new Date(r.playing_started_at)) / 1000);
    }
    const [updated] = await db('recommendations').where({ id: r.id }).update(updates).returning('*');
    results.push(updated);
  }
  return results;
}

async function remove(id) {
  return db('recommendations').where({ id }).delete();
}

async function vote(recommendationId, voterIp, visitorId) {
  // votes insert 와 vote_count increment 를 한 트랜잭션으로 묶어 카운터 드리프트 방지.
  // 중복 투표는 UNIQUE(recommendation_id, voter_ip) 위반(23505) → trx rollback 되고
  // 에러가 그대로 전파되어 라우트에서 409 처리됨(동작 동일).
  return db.transaction(async (trx) => {
    await trx('votes').insert({ recommendation_id: recommendationId, voter_ip: voterIp, visitor_id: visitorId || null });
    const [rec] = await trx('recommendations')
      .where({ id: recommendationId })
      .increment('vote_count', 1)
      .returning('*');
    return rec;
  });
}

async function unvote(recommendationId, voterIp) {
  // votes delete 와 vote_count decrement 를 한 트랜잭션으로 묶음.
  // 투표 기록이 없으면 throw → rollback(삭제 0건이라 되돌릴 것도 없음) + 404 전파.
  return db.transaction(async (trx) => {
    const deleted = await trx('votes')
      .where({ recommendation_id: recommendationId, voter_ip: voterIp })
      .delete();
    if (!deleted) throw Object.assign(new Error('투표 기록이 없습니다'), { status: 404 });
    const [rec] = await trx('recommendations')
      .where({ id: recommendationId })
      .where('vote_count', '>', 0)
      .decrement('vote_count', 1)
      .returning('*');
    return rec;
  });
}

async function addComment(recommendationId, { commenterIp, commenterName, body }) {
  const [comment] = await db('comments')
    .insert({ recommendation_id: recommendationId, commenter_ip: commenterIp, commenter_name: commenterName, body })
    .returning('*');
  return comment;
}

module.exports = { getRecommendations, findById, findActiveByVideoId, countActive, add, updateStatus, clearPlaying, remove, vote, unvote, addComment };
