const db = require('../db/knex');
const { canonicalizeVideoId } = require('../utils/video-id');

function withCafeName(query) {
  return query
    .leftJoin('cafes', 'song_comments.cafe_id', 'cafes.id')
    .select('song_comments.*', 'cafes.name as cafe_name');
}

// 전체 카페 공유 댓글. 최상위 댓글만 페이지 단위로 고른 뒤 그 부모들의
// 답글을 한 번에 조회한다. 과거 데이터는 canonicalize migration으로 보정돼
// 있어 exact match가 가능하고, 복합 인덱스를 그대로 사용할 수 있다.
async function getComments(videoId, { offset, limit }) {
  const canonicalVideoId = canonicalizeVideoId(videoId);
  const rows = await withCafeName(
    db('song_comments')
      .where('song_comments.video_id', canonicalVideoId)
      .whereNull('song_comments.parent_id'),
  )
    .orderBy('song_comments.created_at', 'desc')
    .orderBy('song_comments.id', 'desc')
    .limit(limit + 1)
    .offset(offset);

  const items = rows.slice(0, limit);
  const parentIds = items.map(comment => comment.id);
  const repliesByParent = new Map(parentIds.map(id => [id, []]));

  if (parentIds.length > 0) {
    const replies = await withCafeName(
      db('song_comments')
        .where('song_comments.video_id', canonicalVideoId)
        .whereIn('song_comments.parent_id', parentIds),
    )
      .orderBy('song_comments.created_at', 'asc')
      .orderBy('song_comments.id', 'asc');

    for (const reply of replies) repliesByParent.get(reply.parent_id)?.push(reply);
  }

  const hasMore = rows.length > limit;
  return {
    items: items.map(comment => ({
      ...comment,
      replies: repliesByParent.get(comment.id) || [],
    })),
    hasMore,
    nextOffset: hasMore ? offset + items.length : null,
  };
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
