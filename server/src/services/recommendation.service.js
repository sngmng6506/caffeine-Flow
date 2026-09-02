const db = require('../db/knex');
const { REC_STATUS, ACTIVE_STATUSES, TERMINAL_STATUSES } = require('../constants/recommendation-status');
const { FILTER_STATUS } = require('../constants/music-filter-status');
const { PLATFORM } = require('../constants/platforms');
const { canonicalizeVideoId } = require('../utils/video-id');
const { kstStartOfDay } = require('../utils/kst');
const { HISTORY_SORT_AT_SQL, CANONICAL_VIDEO_ID_SQL } = require('../db/sql-fragments');
const { RECENT_HISTORY_LOOKBACK_DAYS } = require('../constants/time-policy');
const playbackHistoryService = require('./playback-history.service');

async function getRecommendations(cafeId) {
  return db('recommendations')
    .where({ cafe_id: cafeId })
    .whereIn('status', ACTIVE_STATUSES)
    .orderBy('vote_count', 'desc')
    .orderBy('requested_at', 'asc');
}

async function getRecentHistory(cafeId, offset = 0, limit = 20) {
  const since = kstStartOfDay(RECENT_HISTORY_LOOKBACK_DAYS);
  const fetchLimit = offset + limit + 1;
  const recommendationRows = await db('recommendations')
    .where({ cafe_id: cafeId })
    .whereIn('status', [REC_STATUS.PLAYED, REC_STATUS.SKIPPED])
    .whereRaw(`${HISTORY_SORT_AT_SQL} >= ?`, [since])
    .orderByRaw(`${HISTORY_SORT_AT_SQL} DESC`)
    .orderBy('requested_at', 'desc')
    .orderBy('id', 'desc')
    .limit(fetchLimit);
  const manualPage = await playbackHistoryService.getRecent(cafeId, {
    since,
    offset: 0,
    limit: fetchLimit,
  });
  const rows = [...recommendationRows, ...manualPage.items].sort((left, right) => {
    const leftAt = new Date(left.played_at || left.requested_at).getTime();
    const rightAt = new Date(right.played_at || right.requested_at).getTime();
    if (leftAt !== rightAt) return rightAt - leftAt;
    return String(right.id).localeCompare(String(left.id));
  });
  return {
    items: rows.slice(offset, offset + limit),
    hasMore: rows.length > offset + limit,
  };
}

async function findById(id) {
  return db('recommendations').where({ id }).first();
}

async function findByIdForCafe(cafeId, id, dbOrTrx = db) {
  return dbOrTrx('recommendations').where({ id, cafe_id: cafeId }).first();
}

async function requireForCafe(dbOrTrx, cafeId, id, { forUpdate = false } = {}) {
  let query = dbOrTrx('recommendations').where({ id, cafe_id: cafeId });
  if (forUpdate) query = query.forUpdate();
  const rec = await query.first();
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

async function insertRecommendation(dbOrTrx, cafeId, {
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
  filterPromptSnapshot = null,
}) {
  const hasFilterResult = filterStatus && filterStatus !== FILTER_STATUS.SKIPPED;
  const [rec] = await dbOrTrx('recommendations')
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
      filter_prompt_snapshot: filterPromptSnapshot,
      filter_checked_at: hasFilterResult ? db.fn.now() : null,
    })
    .returning('*');
  return rec;
}

async function add(cafeId, payload) {
  return insertRecommendation(db, cafeId, payload);
}

// 공개 신청은 cafe 행 잠금 안에서 최종 중복·큐 한도와 insert를 묶는다.
// 라우트의 사전 체크는 불필요한 LLM 호출을 줄일 뿐, 동시 요청에 대한 최종
// 일관성은 이 트랜잭션이 보장한다.
async function addWithinQueueLimit(cafeId, payload, maxQueueSize) {
  return db.transaction(async (trx) => {
    const cafe = await trx('cafes').where({ id: cafeId }).select('id').forUpdate().first();
    if (!cafe) throw Object.assign(new Error('카페를 찾을 수 없습니다'), { status: 404 });

    const duplicate = await trx('recommendations')
      .where({ cafe_id: cafeId, video_id: canonicalizeVideoId(payload.videoId) })
      .whereIn('status', ACTIVE_STATUSES)
      .first();
    if (duplicate) {
      throw Object.assign(new Error('이미 대기 중인 곡입니다'), { code: 'ACTIVE_RECOMMENDATION_DUPLICATE', status: 409 });
    }

    const row = await trx('recommendations')
      .where({ cafe_id: cafeId })
      .whereIn('status', ACTIVE_STATUSES)
      .count('id as n')
      .first();
    if (Number(row.n) >= maxQueueSize) {
      throw Object.assign(new Error(`대기열이 가득 찼습니다 (최대 ${maxQueueSize}곡)`), { code: 'QUEUE_FULL', status: 429 });
    }

    return insertRecommendation(trx, cafeId, payload);
  });
}

// 종료 상태(played/skipped/rejected)에서는 어떤 전이도 불가.
// pending↔accepted↔playing 사이는 사장님 드래그 UI가 양방향 이동을
// 허용하므로 자유 전이. (playing→accepted 되돌리기 등)
function isValidTransition(from, to) {
  if (from === to) return true;
  return !TERMINAL_STATUSES.includes(from);
}

async function updateStatusRow(dbOrTrx, current, status) {
  const now = new Date();
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

  const [rec] = await dbOrTrx('recommendations')
    .where({ id: current.id, cafe_id: current.cafe_id })
    .update(updates)
    .returning('*');
  return rec;
}

async function clearPlayingRows(dbOrTrx, cafeId, exceptId) {
  const now = new Date();
  let query = dbOrTrx('recommendations').where({ cafe_id: cafeId, status: REC_STATUS.PLAYING });
  if (exceptId) query = query.whereNot({ id: exceptId });

  const playingRecs = await query.clone().select('id', 'playing_started_at');
  const results = [];
  for (const r of playingRecs) {
    const updates = { status: REC_STATUS.PLAYED, played_at: now };
    if (r.playing_started_at) {
      updates.play_duration_seconds = Math.round((now - new Date(r.playing_started_at)) / 1000);
    }
    const [updated] = await dbOrTrx('recommendations')
      .where({ id: r.id, cafe_id: cafeId })
      .update(updates)
      .returning('*');
    results.push(updated);
  }
  return results;
}

// 카페 행을 잠가 기존 playing 종료와 새 playing 전환을 직렬화한다.
// owner 소켓 이벤트가 동시에 들어와도 카페마다 마지막 요청 한 곡만
// playing으로 남고, 유효하지 않은 target은 기존 곡을 건드리기 전에 차단한다.
async function setPlaying(cafeId, id) {
  return db.transaction(async (trx) => {
    const cafe = await trx('cafes').where({ id: cafeId }).select('id').forUpdate().first();
    if (!cafe) throw Object.assign(new Error('카페를 찾을 수 없습니다'), { status: 404 });

    const current = await requireForCafe(trx, cafeId, id, { forUpdate: true });
    if (!isValidTransition(current.status, REC_STATUS.PLAYING)) {
      throw Object.assign(
        new Error(`이미 종료된 곡입니다 (${current.status} → ${REC_STATUS.PLAYING} 불가)`),
        { status: 409 }
      );
    }

    const cleared = await clearPlayingRows(trx, cafeId, id);
    const rec = await updateStatusRow(trx, current, REC_STATUS.PLAYING);
    return { rec, cleared };
  });
}

async function updateStatus(cafeId, id, status) {
  if (status === REC_STATUS.PLAYING) {
    const { rec } = await setPlaying(cafeId, id);
    return rec;
  }

  return db.transaction(async (trx) => {
    const current = await requireForCafe(trx, cafeId, id, { forUpdate: true });
    return updateStatusRow(trx, current, status);
  });
}

async function clearPlaying(cafeId, exceptId) {
  return db.transaction(async (trx) => {
    const cafe = await trx('cafes').where({ id: cafeId }).select('id').forUpdate().first();
    if (!cafe) throw Object.assign(new Error('카페를 찾을 수 없습니다'), { status: 404 });
    return clearPlayingRows(trx, cafeId, exceptId);
  });
}

async function remove(cafeId, id) {
  return db('recommendations').where({ id, cafe_id: cafeId }).delete();
}

// 좋아요는 신청 건이 아니라 곡에 붙는다. 같은 곡이 여러 번 신청되면 행은
// 여러 개지만 표는 (카페, 곡, 방문자)당 하나이고, 그 카페의 같은 곡 행들은
// 모두 같은 vote_count를 본다.
//
// 계약: docs/AI_CHANGE_GUARDRAILS.md#anonymous-visitor-identity-contract

/** 카페 안의 한 곡에 달린 표를 세어 그 곡의 모든 행에 반영한다. */
async function syncSongVoteCount(trx, cafeId, trackKey) {
  const [{ count }] = await trx('votes').where({ cafe_id: cafeId, track_key: trackKey }).count('id as count');
  const total = Number(count);
  await trx('recommendations')
    .where({ cafe_id: cafeId })
    .whereRaw(`${CANONICAL_VIDEO_ID_SQL} = ?`, [trackKey])
    .update({ vote_count: total });
  return total;
}

/** 곡 좋아요 결과 — 표시에 필요한 최소 정보만 담는다. */
async function songVoteResult(trx, cafeId, trackKey, total) {
  const rows = await trx('recommendations')
    .where({ cafe_id: cafeId })
    .whereRaw(`${CANONICAL_VIDEO_ID_SQL} = ?`, [trackKey])
    .select('*');
  return { trackKey, voteCount: total, recommendations: rows };
}

async function voteSong(cafeId, trackKey, voterIp, visitorId, { recommendationId = null } = {}) {
  if (!trackKey) throw Object.assign(new Error('곡을 찾을 수 없습니다'), { status: 404 });
  return db.transaction(async (trx) => {
    // 카페 잠금으로 같은 곡의 동시 투표가 카운트를 어긋나게 하지 않는다.
    const cafe = await trx('cafes').where({ id: cafeId }).select('id').forUpdate().first();
    if (!cafe) throw Object.assign(new Error('카페를 찾을 수 없습니다'), { status: 404 });
    // 전체 TOP에는 우리 매장에서 재생된 적 없는 곡도 나온다. 그 곡에도 좋아요를
    // 남길 수 있어야 하므로 존재 확인은 전역으로 한다 — 임의 문자열은 막되
    // "어딘가에서 실제로 재생된 곡"이면 받는다.
    const known = await trx('recommendations')
      .whereRaw(`${CANONICAL_VIDEO_ID_SQL} = ?`, [trackKey])
      .first('id');
    if (!known) throw Object.assign(new Error('곡을 찾을 수 없습니다'), { status: 404 });
    // 표는 이 매장에 남는다. 우리 매장에 그 곡의 행이 있으면 함께 연결한다.
    const local = await trx('recommendations')
      .where({ cafe_id: cafeId })
      .whereRaw(`${CANONICAL_VIDEO_ID_SQL} = ?`, [trackKey])
      .first('id');

    await trx('votes').insert({
      cafe_id: cafeId,
      track_key: trackKey,
      recommendation_id: recommendationId || local?.id || null,
      voter_ip: voterIp,
      visitor_id: visitorId || null,
    });
    const total = await syncSongVoteCount(trx, cafeId, trackKey);
    return songVoteResult(trx, cafeId, trackKey, total);
  });
}

async function unvoteSong(cafeId, trackKey, voterIp, visitorId) {
  if (!trackKey) throw Object.assign(new Error('곡을 찾을 수 없습니다'), { status: 404 });
  return db.transaction(async (trx) => {
    const cafe = await trx('cafes').where({ id: cafeId }).select('id').forUpdate().first();
    if (!cafe) throw Object.assign(new Error('카페를 찾을 수 없습니다'), { status: 404 });

    let query = trx('votes').where({ cafe_id: cafeId, track_key: trackKey });
    query = visitorId
      ? query.where({ visitor_id: visitorId })
      : query.whereNull('visitor_id').where({ voter_ip: voterIp });
    const deleted = await query.delete();
    if (!deleted) throw Object.assign(new Error('투표 기록이 없습니다'), { status: 404 });

    const total = await syncSongVoteCount(trx, cafeId, trackKey);
    return songVoteResult(trx, cafeId, trackKey, total);
  });
}

/** 신청곡 ID로 들어온 요청을 곡 단위로 넘긴다. 손님 화면의 기존 경로다. */
async function vote(cafeId, recommendationId, voterIp, visitorId) {
  const rec = await findByIdForCafe(cafeId, recommendationId);
  if (!rec) throw Object.assign(new Error('추천곡을 찾을 수 없습니다'), { status: 404 });
  const result = await voteSong(cafeId, canonicalizeVideoId(rec.video_id), voterIp, visitorId, { recommendationId });
  return result.recommendations.find(row => row.id === recommendationId) || rec;
}

async function unvote(cafeId, recommendationId, voterIp, visitorId) {
  const rec = await findByIdForCafe(cafeId, recommendationId);
  if (!rec) throw Object.assign(new Error('추천곡을 찾을 수 없습니다'), { status: 404 });
  const result = await unvoteSong(cafeId, canonicalizeVideoId(rec.video_id), voterIp, visitorId);
  return result.recommendations.find(row => row.id === recommendationId) || rec;
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
  getRecentHistory,
  findById,
  findByIdForCafe,
  findActiveByVideoId,
  countActive,
  add,
  addWithinQueueLimit,
  updateStatus,
  setPlaying,
  clearPlaying,
  remove,
  vote,
  unvote,
  voteSong,
  unvoteSong,
  addComment,
  isValidTransition,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
};
