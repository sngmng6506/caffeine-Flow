// 손님(미인증) 전용 추천곡 라우트.
// 사장님 라우트는 recommendations.owner.js 참조.
const router    = require('express').Router({ mergeParams: true });
const cafeService   = require('../services/cafe.service');
const recService    = require('../services/recommendation.service');
const statsService  = require('../services/stats.service');
const musicFilter   = require('../features/music-filter');
const { verifyTrackMetadataToken } = require('../services/track-metadata-token.service');
const db            = require('../db/knex');
const { MAX_QUEUE_SIZE, broadcast, broadcastToOwners, broadcastRecommendation, getClientIp, safeVisitorId, makeDualLimiter } = require('./_recommendations.shared');
const { validateString, isUuid } = require('../utils/validate');
const { REC_STATUS } = require('../constants/recommendation-status');
const { FILTER_ACTION, FILTER_STATUS } = require('../constants/music-filter-status');
const { parseAllowedPlatforms, platformLabel } = require('../constants/platforms');
const { RECOMMENDATION_REQUEST_LIMIT, VOTE_LIMIT, COMMENT_LIMIT } = require('../constants/limits');
const { KST_VISIT_DATE_SQL } = require('../db/sql-fragments');
const { parseOffset, parseTopSort } = require('../utils/pagination');
const { publicRecommendation, recommendationComment } = require('../utils/public-response');

const requestLimiters = makeDualLimiter({ ...RECOMMENDATION_REQUEST_LIMIT, message: '잠시 후 다시 추천해주세요 (1분에 3곡 제한)' });
const voteLimiters = makeDualLimiter({ ...VOTE_LIMIT, message: '잠시 후 다시 시도해주세요 (투표 한도 초과)' });
const commentLimiters = makeDualLimiter({ ...COMMENT_LIMIT, message: '잠시 후 다시 댓글을 남겨주세요 (1분에 5개 제한)' });

function filterPayload(filterResult) {
  return {
    filterStatus: filterResult.filterStatus,
    filterReason: filterResult.reason,
    filterConfidence: filterResult.confidence,
    filterModel: filterResult.model,
    filterErrorCode: filterResult.errorCode,
    filterPromptSnapshot: filterResult.promptSnapshot,
  };
}

async function findCafeForMutation(req, res) {
  const cafe = await cafeService.findActiveBySlug(req.params.slug);
  if (!cafe) {
    res.status(404).json({ error: 'Cafe not found' });
    return null;
  }
  return cafe;
}

function sendServiceError(res, err) {
  if (err.status) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) return res.status(400).json({ error: '추천곡 ID 형식 오류' });
  next();
});

router.get('/', async (req, res) => {
  const cafe = await cafeService.findActiveBySlug(req.params.slug);
  if (!cafe) {
    const moved = await cafeService.findMovedSlug(req.params.slug);
    if (moved) return res.status(404).json({ error: 'Cafe moved', movedTo: moved });
    return res.status(404).json({ error: 'Cafe not found' });
  }
  const recs = await recService.getRecommendations(cafe.id);
  const ip = getClientIp(req);
  const visitorId = safeVisitorId(req);
  try {
    await db('cafe_visits')
      .insert({ cafe_id: cafe.id, visitor_ip: ip, visitor_id: visitorId, visit_date: db.raw(KST_VISIT_DATE_SQL) })
      .onConflict()
      .ignore();
  } catch {
    // 방문 통계 실패가 큐 조회를 막아서는 안 된다.
  }
  const allowed_platforms = parseAllowedPlatforms(cafe.allowed_platforms);
  res.json({
    recommendations: recs.map(rec => publicRecommendation(rec, { visitorId })),
    is_accepting: cafe.is_accepting,
    // 기존 손님 UI의 공지 섹션 계약은 유지하되 원본 매장 설명이 아닌
    // 저장된 공개용 신청곡 안내만 전달한다.
    notice: cafe.music_filter_public_notice || null,
    cafe_name: cafe.name,
    allowed_platforms,
  });
});

router.post('/', requestLimiters, async (req, res) => {
  const cafe = await cafeService.findActiveBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
  if (!cafe.is_accepting) return res.status(403).json({ error: '현재 추천을 받지 않습니다' });
  const body = req.body || {};
  const nameCheck = validateString(body.requesterName, { max: 50, allowNull: true, name: 'requesterName' });
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });
  let track;
  try {
    track = verifyTrackMetadataToken(body.metadataToken);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  const { videoId, title, channelTitle, thumbnail, duration, platform } = track;
  const requesterName = nameCheck.value;
  const allowed = parseAllowedPlatforms(cafe.allowed_platforms);
  if (!allowed.includes(platform)) return res.status(403).json({ error: `이 카페에서는 ${platformLabel(platform)} 신청을 받지 않습니다` });
  const duplicate = await recService.findActiveByVideoId(cafe.id, videoId);
  if (duplicate) return res.status(409).json({ error: '이미 대기 중인 곡입니다' });
  const queueCount = await recService.countActive(cafe.id);
  if (queueCount >= MAX_QUEUE_SIZE) return res.status(429).json({ error: `대기열이 가득 찼습니다 (최대 ${MAX_QUEUE_SIZE}곡)` });
  const filterResult = await musicFilter.evaluateRecommendation({ cafe, track: { videoId, title, channelTitle, thumbnail, duration, platform } });
  const ip = getClientIp(req);
  const visitorId = safeVisitorId(req);
  let rec;
  try {
    rec = await recService.addWithinQueueLimit(cafe.id, {
      videoId, title, channelTitle, thumbnail, duration, requesterIp: ip, requesterName, platform, visitorId,
      status: filterResult.action === FILTER_ACTION.REJECT ? REC_STATUS.REJECTED : REC_STATUS.PENDING,
      ...filterPayload(filterResult),
    }, MAX_QUEUE_SIZE);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '이미 대기 중인 곡입니다' });
    if (sendServiceError(res, err)) return;
    throw err;
  }
  if (filterResult.action === FILTER_ACTION.REJECT) {
    if (filterResult.filterStatus === FILTER_STATUS.ERROR_REJECTED) {
      broadcastToOwners(req, req.params.slug, 'music_filter_error', { title, platform, reason: filterResult.reason, errorCode: filterResult.errorCode, occurredAt: new Date().toISOString() });
      return res.status(503).json({ error: 'AI 필터 확인 중 문제가 발생해 신청할 수 없습니다. 잠시 후 다시 시도해주세요.' });
    }
    return res.status(403).json({ error: '이 곡은 매장 분위기와 맞지 않아 신청할 수 없습니다.' });
  }
  broadcastRecommendation(req, req.params.slug, { action: 'add', rec });
  res.status(201).json(publicRecommendation(rec, { visitorId }));
});

router.get('/history', async (req, res) => {
  const cafe = await cafeService.findActiveBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
  const offset = parseOffset(req.query.offset);
  if (offset.error) return res.status(400).json({ error: offset.error });
  const page = await recService.getRecentHistory(cafe.id, offset.value);
  res.json({ ...page, items: page.items.map(publicRecommendation) });
});

router.get('/top10', async (req, res) => {
  const cafe = await cafeService.findActiveBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
  const offset = parseOffset(req.query.offset);
  if (offset.error) return res.status(400).json({ error: offset.error });
  const sort = parseTopSort(req.query.sort);
  if (sort.error) return res.status(400).json({ error: sort.error });
  res.json(await statsService.getCafeTop10(cafe.id, offset.value, sort.value));
});

router.delete('/:id/cancel', async (req, res) => {
  const cafe = await findCafeForMutation(req, res);
  if (!cafe) return;
  const rec = await recService.findByIdForCafe(cafe.id, req.params.id);
  if (!rec) return res.status(404).json({ error: '추천곡을 찾을 수 없습니다' });
  if (![REC_STATUS.PENDING, REC_STATUS.ACCEPTED].includes(rec.status)) return res.status(409).json({ error: '이미 처리된 추천곡은 취소할 수 없습니다' });
  const visitorId = safeVisitorId(req);
  const isOwner = Boolean(rec.visitor_id && visitorId && rec.visitor_id === visitorId);
  if (!isOwner) return res.status(403).json({ error: '본인이 신청한 곡만 취소할 수 있습니다' });
  const deleted = await recService.remove(cafe.id, rec.id);
  if (!deleted) return res.status(404).json({ error: '추천곡을 찾을 수 없습니다' });
  broadcastRecommendation(req, req.params.slug, { action: 'delete', id: rec.id });
  res.json({ ok: true });
});

// 곡 단위 좋아요. TOP 목록에는 신청곡 ID가 없고 곡 키만 있으므로 이 경로를 쓴다.
// 최근 재생·큐의 `/:id/vote`와 같은 표를 공유한다 — 한 사람이 한 곡에 한 표다.
function songVotePayload(result) {
  return { track_key: result.trackKey, vote_count: result.voteCount };
}

function broadcastSongVote(req, slug, result) {
  broadcast(req, slug, 'song_vote', songVotePayload(result));
  for (const rec of result.recommendations) broadcastRecommendation(req, slug, { action: 'vote', rec });
}

router.post('/songs/:trackKey/vote', voteLimiters, async (req, res) => {
  const cafe = await findCafeForMutation(req, res);
  if (!cafe) return;
  try {
    const result = await recService.voteSong(cafe.id, req.params.trackKey, getClientIp(req), safeVisitorId(req));
    broadcastSongVote(req, req.params.slug, result);
    res.json(songVotePayload(result));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '이미 투표했습니다' });
    if (sendServiceError(res, err)) return;
    throw err;
  }
});

router.delete('/songs/:trackKey/vote', voteLimiters, async (req, res) => {
  const cafe = await findCafeForMutation(req, res);
  if (!cafe) return;
  try {
    const result = await recService.unvoteSong(cafe.id, req.params.trackKey, getClientIp(req), safeVisitorId(req));
    broadcastSongVote(req, req.params.slug, result);
    res.json(songVotePayload(result));
  } catch (err) {
    if (sendServiceError(res, err)) return;
    throw err;
  }
});

router.post('/:id/vote', voteLimiters, async (req, res) => {
  const cafe = await findCafeForMutation(req, res);
  if (!cafe) return;
  const ip = getClientIp(req);
  const visitorId = safeVisitorId(req);
  try {
    const rec = await recService.vote(cafe.id, req.params.id, ip, visitorId);
    broadcastRecommendation(req, req.params.slug, { action: 'vote', rec });
    res.json(publicRecommendation(rec, { visitorId }));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '이미 투표했습니다' });
    if (sendServiceError(res, err)) return;
    throw err;
  }
});

router.delete('/:id/vote', voteLimiters, async (req, res) => {
  const cafe = await findCafeForMutation(req, res);
  if (!cafe) return;
  const visitorId = safeVisitorId(req);
  try {
    const rec = await recService.unvote(cafe.id, req.params.id, getClientIp(req), visitorId);
    broadcastRecommendation(req, req.params.slug, { action: 'vote', rec });
    res.json(publicRecommendation(rec, { visitorId }));
  } catch (err) {
    if (sendServiceError(res, err)) return;
    throw err;
  }
});

router.post('/:id/comments', commentLimiters, async (req, res) => {
  const cafe = await findCafeForMutation(req, res);
  if (!cafe) return;
  const bodyCheck = validateString(req.body?.body, { max: 200, name: 'body' });
  if (bodyCheck.error) return res.status(400).json({ error: bodyCheck.error });
  const nameCheck = validateString(req.body?.commenterName, { max: 50, allowNull: true, name: 'commenterName' });
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });
  try {
    const comment = await recService.addComment(cafe.id, req.params.id, { commenterIp: getClientIp(req), commenterName: nameCheck.value, body: bodyCheck.value });
    const safeComment = recommendationComment(comment);
    broadcast(req, req.params.slug, 'comment_added', { recommendationId: req.params.id, comment: safeComment });
    res.status(201).json(safeComment);
  } catch (err) {
    if (sendServiceError(res, err)) return;
    throw err;
  }
});

module.exports = router;
