const db = require('../db/knex');
const { canonicalizeVideoId } = require('../utils/video-id');

function withCafeName(query) {
  return query
    .leftJoin('cafes', 'song_comments.cafe_id', 'cafes.id')
    .select('song_comments.*', 'cafes.name as cafe_name');
}

// 전체 카페 공유 댓글 (video_id 기준, 추적 파라미터 무시하고 곡 단위로 통합)
async function getComments(videoId) {
  // split_part 로 ? 이전만 비교 → 과거 raw 저장분(abc?si=1)과 신규 canonical(abc) 모두 매칭.
  // (canonicalizeVideoId 와 동일 규칙. 댓글은 곡당 소량이라 인덱스 미사용 부담 없음.)
  const all = await withCafeName(
    db('song_comments').whereRaw(`split_part(song_comments.video_id, ?, 1) = ?`, ['?', canonicalizeVideoId(videoId)])
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
    .insert({ video_id: canonicalizeVideoId(videoId), cafe_id: cafeId, commenter_ip: commenterIp, commenter_name: commenterName, body, visitor_id: visitorId || null })
    .returning('*');
  return { ...comment, cafe_name: null, replies: [] };
}

async function addReply(videoId, parentId, cafeId = null, { commenterIp, commenterName, body, visitorId }) {
  const parent = await db('song_comments').where({ id: parentId }).first();
  if (
    !parent
    || parent.parent_id !== null
    || canonicalizeVideoId(parent.video_id) !== canonicalizeVideoId(videoId)
  ) {
    throw Object.assign(new Error('유효하지 않은 댓글'), { status: 400 });
  }

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
