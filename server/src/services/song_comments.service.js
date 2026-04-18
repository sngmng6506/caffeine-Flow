const db = require('../db/knex');

function withCafeName(query) {
  return query
    .leftJoin('cafes', 'song_comments.cafe_id', 'cafes.id')
    .select('song_comments.*', 'cafes.name as cafe_name');
}

// 전체 카페 공유 댓글 (video_id 기준)
async function getComments(videoId) {
  const all = await withCafeName(
    db('song_comments').where({ 'song_comments.video_id': videoId })
  ).orderBy('song_comments.created_at', 'asc');

  const topLevel = all.filter(c => c.parent_id === null);
  const replies  = all.filter(c => c.parent_id !== null);

  return topLevel.map(c => ({
    ...c,
    replies: replies.filter(r => r.parent_id === c.id),
  })).reverse();
}

async function addComment(videoId, cafeId = null, { commenterIp, commenterName, body, visitorId }) {
  const [comment] = await db('song_comments')
    .insert({ video_id: videoId, cafe_id: cafeId, commenter_ip: commenterIp, commenter_name: commenterName, body, visitor_id: visitorId || null })
    .returning('*');
  return { ...comment, cafe_name: null, replies: [] };
}

async function addReply(parentId, cafeId = null, { commenterIp, commenterName, body, visitorId }) {
  const parent = await db('song_comments').where({ id: parentId }).first();
  if (!parent || parent.parent_id !== null) throw Object.assign(new Error('유효하지 않은 댓글'), { status: 400 });

  const [reply] = await db('song_comments')
    .insert({
      video_id:       parent.video_id,
      cafe_id:        cafeId,
      parent_id:      parentId,
      commenter_ip:   commenterIp,
      commenter_name: commenterName,
      body,
      visitor_id:     visitorId || null,
    })
    .returning('*');
  return { ...reply, cafe_name: null };
}

module.exports = { getComments, addComment, addReply };
