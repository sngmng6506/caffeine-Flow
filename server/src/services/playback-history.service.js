const db = require('../db/knex');
const { canonicalizeVideoId } = require('../utils/video-id');
const { shouldStorePlayback } = require('./playback-history-policy');

function toHistoryItem(row) {
  return {
    id: row.id,
    video_id: row.video_id || row.comment_key,
    title: row.title,
    channel_title: row.channel_title,
    thumbnail: row.thumbnail,
    platform: row.platform,
    status: 'played',
    vote_count: 0,
    requested_at: row.started_at,
    played_at: row.ended_at,
    playing_started_at: row.started_at,
    play_duration_seconds: row.play_duration_seconds,
    playback_source: 'owner',
    link_available: Boolean(row.video_id),
  };
}

async function finalize(cafeId, payload) {
  const videoId = payload.videoId ? canonicalizeVideoId(payload.videoId) : null;
  const commentKey = canonicalizeVideoId(payload.commentKey);
  const durationSeconds = Math.max(0, Math.floor(payload.durationSeconds));
  const shouldStoreHistory = shouldStorePlayback({
    endReason: payload.endReason,
    durationSeconds,
  });

  return db.transaction(async (trx) => {
    let commentsRekeyed = 0;
    if (videoId && videoId !== commentKey) {
      commentsRekeyed = await trx('song_comments')
        .where({ cafe_id: cafeId, video_id: commentKey })
        .update({ video_id: videoId });
    }

    if (!shouldStoreHistory) {
      return { stored: false, commentsRekeyed: Number(commentsRekeyed) };
    }

    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - durationSeconds * 1000);
    const rows = await trx('playback_history')
      .insert({
        cafe_id: cafeId,
        session_id: payload.sessionId,
        video_id: videoId,
        comment_key: videoId || commentKey,
        title: payload.title,
        channel_title: payload.artist,
        thumbnail: payload.thumbnail,
        platform: payload.platform,
        started_at: startedAt,
        ended_at: endedAt,
        play_duration_seconds: durationSeconds,
        end_reason: payload.endReason,
      })
      .onConflict('session_id')
      .ignore()
      .returning('*');

    return {
      stored: rows.length > 0,
      commentsRekeyed: Number(commentsRekeyed),
      item: rows[0] ? toHistoryItem(rows[0]) : null,
    };
  });
}

async function getRecent(cafeId, { since, offset = 0, limit = 20 }) {
  const rows = await db('playback_history')
    .where({ cafe_id: cafeId })
    .where('ended_at', '>=', since)
    .orderBy('ended_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1)
    .offset(offset);
  return { items: rows.slice(0, limit).map(toHistoryItem), hasMore: rows.length > limit };
}

module.exports = { finalize, getRecent, toHistoryItem };
