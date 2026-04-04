const db = require('../db/knex');

function todayRange() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end   = new Date(); end.setHours(23, 59, 59, 999);
  return [start, end];
}

async function getRecommendations(cafeId) {
  return db('recommendations')
    .where({ cafe_id: cafeId })
    .whereBetween('requested_at', todayRange())
    .orderBy('vote_count', 'desc')
    .orderBy('requested_at', 'asc');
}

async function add(cafeId, { videoId, title, channelTitle, thumbnail, duration, requesterIp, requesterName }) {
  const [rec] = await db('recommendations')
    .insert({
      cafe_id:        cafeId,
      video_id:       videoId,
      title,
      channel_title:  channelTitle,
      thumbnail,
      duration,
      requester_ip:   requesterIp,
      requester_name: requesterName,
    })
    .returning('*');
  return rec;
}

async function updateStatus(id, status) {
  const updates = { status };
  if (status === 'played') updates.played_at = new Date();
  const [rec] = await db('recommendations').where({ id }).update(updates).returning('*');
  return rec;
}

async function remove(id) {
  return db('recommendations').where({ id }).delete();
}

async function vote(recommendationId, voterIp) {
  // UNIQUE(recommendation_id, voter_ip) 제약으로 중복 투표 차단 (23505 에러)
  await db('votes').insert({ recommendation_id: recommendationId, voter_ip: voterIp });
  const [rec] = await db('recommendations')
    .where({ id: recommendationId })
    .increment('vote_count', 1)
    .returning('*');
  return rec;
}

async function addComment(recommendationId, { commenterIp, commenterName, body }) {
  const [comment] = await db('comments')
    .insert({ recommendation_id: recommendationId, commenter_ip: commenterIp, commenter_name: commenterName, body })
    .returning('*');
  return comment;
}

module.exports = { getRecommendations, add, updateStatus, remove, vote, addComment };
