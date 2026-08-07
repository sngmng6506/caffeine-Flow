const db = require('../db/knex');
const { kstStartOfDay } = require('../utils/kst');
const { REC_STATUS, ACTIVE_STATUSES, TERMINAL_STATUSES } = require('../constants/recommendation-status');
const { FILTER_STATUS } = require('../constants/music-filter-status');
const { PLATFORM } = require('../constants/platforms');
const { ACTIVE_QUEUE_LOOKBACK_DAYS, MS_PER_DAY } = require('../constants/time-policy');
const { canonicalizeVideoId } = require('../utils/video-id');

// 최근 7일: KST 기준 6일 전 00:00 ~ 오늘 23:59:59.999
function lastSevenDaysRange() {
  const start = kstStartOfDay(ACTIVE_QUEUE_LOOKBACK_DAYS);
  const end   = new Date(kstStartOfDay(0).getTime() + MS_PER_DAY - 1);
  return [start, end];
}

async function getRecommendations(cafeId) {
  return db('recommendations')
    .where({ cafe_id: cafeId })
    .whereIn('status', ACTIVE_STATUSES)
    .whereBetween('requested_at', lastSevenDaysRange())
    .orderBy('vote_count', 'desc')
    .orderBy('requested_at', 'asc');
}

async function findById(id) {
  return db('recommendations').where({ id }).first();
}

async function findByIdForCafe(cafeId, id, dbOrTrx = db) {
  return dbOrTrx('recommendations').where({ id, cafe_id: cafeId }).first();
}

async function requireForCafe(dbOrTrx, cafeId, id) {
  const rec = await findByIdForCafe(cafeId, id, dbOrTrx);
  if (!rec) throw Object.assign(new Error('추천곡을 찾을 수 없습니다'), { status: 404 });
  return rec;
}

async function findActiveByVideoId(cafeId, videoId) {
  return db('recommendations')
    .where({ cafe_id: cafeId, video_id: canonicalizeVideoId(videoId) })
    .whereIn('status', ACTIVE_STATUSES)
    .first();
}

async function countActive(cafeId) {
  const row = await db('recommendations')
    .where({ cafe_id: cafeId })
    .whereIn('status', ACTIVE_STATUSES)
    .count('id as n')
    .first();
  return parseInt(row.n);
}

async function add(cafeId, {
  videoId,
  title,
  channelTitle,
  thumbnail,
  duration,
  requesterIp,
  requesterName,
  platform = PLATFORM.YOUTUBE,
  visitorId,
  status = REC_STATUS.PENDING,
  filterStatus = FILTER_STATUS.SKIPPED,
  filterReason = null,
  filterConfidence = null,
  filterModel = null,
  filterErrorCode = null,
}) {
  const hasFilterResult = filterStatus && filterStatus !== FILTER_STATUS.SKIPPED;
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
      status,
      filter_status:  filterStatus || FILTER_STATUS.SKIPPED,
      filter_reason:  filterReason,
      filter_confidence: filterConfidence,
      filter_model:   filterModel,
      filter_error_code: filterErrorCode,
      filter_checked_at: hasFilterResult ? db.fn.now() : null,
    })
    .returning('*');
  return rec;
}

// 종료 상태(played/skipped/rejected)에서는 어떤 전이도 불가.
// pending↔accepted↔playing 사이는 사장님 드래그 UI가 양방향 이동을
// 허용하므로 자유 전이. (playing→accepted 되돌리기 등)
function isValidTransition(from, to) {
  if (from === to) return true;
  return !TERMINAL_STATUSES.includes(from);
}

async function updateStatus(cafeId, id, status) {
  const now = new Date();
  const current = await requireForCafe(db, cafeId, id);
  if (!isValidTransition(current.status, status)) {
    throw Object.assign(
      new Error(`이미 종료된 곡입니다 (${current.status} → ${status} 불가)`),
      { status: 409 }
    );
  }

  const updates = { status };

  if (status === REC_STATUS.PLAYING) {
    updates.playing_started_at = now;
  }

  if (status === REC_STATUS.PLAYED || status === REC_STATUS.SKIPPED) {
    updates.played_at = now;
    if (current.playing_started_at) {
      updates.play_duration_seconds = Math.round((now - new Date(current.playing_started_at)) / 1000);
    }
  }

  const [rec] = await db('recommendations')
    .where({ id, cafe_id: cafeId })
    .update(updates)
    .returning('*');
  return rec;
}

async function clearPlaying(cafeId, exceptId) {
  const now = new Date();
  let query = db('recommendations').where({ cafe_id: cafeId, status: REC_STATUS.PLAYING });
  if (exceptId) query = query.whereNot({ id: exceptId });

  const playingRecs = await query.clone().select('id', 'playing_started_at');
  const results = [];
  for (const r of playingRecs) {
    const updates = { status: REC_STATUS.PLAYED, played_at: now };
    if (r.playing_started_at) {
      updates.play_duration_seconds = Math.round((now - new Date(r.playing_started_at)) / 1000);
    }
    const [updated] = await db('recommendations')
      .where({ id: r.id, cafe_id: cafeId })
      .update(updates)
      .returning('*');
    results.push(updated);
  }
  return results;
}

async function remove(cafeId, id) {
  return db('recommendations').where({ id, cafe_id: cafeId }).delete();
}

async function vote(cafeId, recommendationId, voterIp, visitorId) {
  return db.transaction(async (trx) => {
    await requireForCafe(trx, cafeId, recommendationId);
    await trx('votes').insert({ recommendation_id: recommendationId, voter_ip: voterIp, visitor_id: visitorId || null });
    const [rec] = await trx('recommendations')
      .where({ id: recommendationId, cafe_id: cafeId })
      .increment('vote_count', 1)
      .returning('*');
    return rec;
  });
}

async function unvote(cafeId, recommendationId, voterIp) {
  return db.transaction(async (trx) => {
    await requireForCafe(trx, cafeId, recommendationId);
    const deleted = await trx('votes')
      .where({ recommendation_id: recommendationId, voter_ip: voterIp })
      .delete();
    if (!deleted) throw Object.assign(new Error('투표 기록이 없습니다'), { status: 404 });
    const [rec] = await trx('recommendations')
      .where({ id: recommendationId, cafe_id: cafeId })
      .where('vote_count', '>', 0)
      .decrement('vote_count', 1)
      .returning('*');
    return rec;
  });
}

async function addComment(cafeId, recommendationId, { commenterIp, commenterName, body }) {
  return db.transaction(async (trx) => {
    await requireForCafe(trx, cafeId, recommendationId);
    const [comment] = await trx('comments')
      .insert({ recommendation_id: recommendationId, commenter_ip: commenterIp, commenter_name: commenterName, body })
      .returning('*');
    return comment;
  });
}

module.exports = {
  getRecommendations,
  findById,
  findByIdForCafe,
  findActiveByVideoId,
  countActive,
  add,
  updateStatus,
  clearPlaying,
  remove,
  vote,
  unvote,
  addComment,
  isValidTransition,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
};
