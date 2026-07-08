const db = require('../db/knex');
const { kstStartOfDay } = require('../utils/kst');

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
    .where({ cafe_id: cafeId, video_id: videoId })
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

async function add(cafeId, {
  videoId,
  title,
  channelTitle,
  thumbnail,
  duration,
  requesterIp,
  requesterName,
  platform = 'youtube',
  visitorId,
  status = 'pending',
  filterStatus = 'skipped',
  filterReason = null,
  filterConfidence = null,
  filterModel = null,
  filterErrorCode = null,
}) {
  const hasFilterResult = filterStatus && filterStatus !== 'skipped';
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
      platform,
      visitor_id:     visitorId || null,
      status,
      filter_status:  filterStatus || 'skipped',
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
const TERMINAL_STATUSES = ['played', 'skipped', 'rejected'];

function isValidTransition(from, to) {
  if (from === to) return true;
  return !TERMINAL_STATUSES.includes(from);
}

async function updateStatus(id, status) {
  const now = new Date();
  const current = await db('recommendations').where({ id }).first();
  if (!current) throw Object.assign(new Error('추천곡을 찾을 수 없습니다'), { status: 404 });
  if (!isValidTransition(current.status, status)) {
    throw Object.assign(
      new Error(`이미 종료된 곡입니다 (${current.status} → ${status} 불가)`),
      { status: 409 }
    );
  }

  const updates = { status };

  if (status === 'playing') {
    updates.playing_started_at = now;
  }

  if (status === 'played' || status === 'skipped') {
    updates.played_at = now;
    // 재생 시작 시각이 있으면 재생 시간 계산
    if (current.playing_started_at) {
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
  // UNIQUE(recommendation_id, voter_ip) 제약으로 중복 투표 차단 (23505 에러)
  await db('votes').insert({ recommendation_id: recommendationId, voter_ip: voterIp, visitor_id: visitorId || null });
  const [rec] = await db('recommendations')
    .where({ id: recommendationId })
    .increment('vote_count', 1)
    .returning('*');
  return rec;
}

async function unvote(recommendationId, voterIp) {
  const deleted = await db('votes')
    .where({ recommendation_id: recommendationId, voter_ip: voterIp })
    .delete();
  if (!deleted) throw Object.assign(new Error('투표 기록이 없습니다'), { status: 404 });
  const [rec] = await db('recommendations')
    .where({ id: recommendationId })
    .where('vote_count', '>', 0)
    .decrement('vote_count', 1)
    .returning('*');
  return rec;
}

async function addComment(recommendationId, { commenterIp, commenterName, body }) {
  const [comment] = await db('comments')
    .insert({ recommendation_id: recommendationId, commenter_ip: commenterIp, commenter_name: commenterName, body })
    .returning('*');
  return comment;
}

module.exports = { getRecommendations, findById, findActiveByVideoId, countActive, add, updateStatus, clearPlaying, remove, vote, unvote, addComment, isValidTransition, TERMINAL_STATUSES };
