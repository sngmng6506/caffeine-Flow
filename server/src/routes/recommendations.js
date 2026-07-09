// 손님(미인증) 전용 추천곡 라우트.
// 사장님 라우트는 recommendations.owner.js 참조.
//
// 같은 prefix(/api/v1/cafes/:slug/recommendations)에 양쪽 라우터가
// 마운트되며, server.js에서 owner를 먼저 등록해 /owner, PUT /:id,
// DELETE /:id가 인증을 통과한 뒤에만 처리되게 한다. 여기서는 /:id
// 자체를 사용하지 않으므로 충돌 가능성 없음.
const router    = require('express').Router({ mergeParams: true });
const cafeService   = require('../services/cafe.service');
const recService    = require('../services/recommendation.service');
const statsService  = require('../services/stats.service');
const musicFilter   = require('../features/music-filter');
const db            = require('../db/knex');
const { MAX_QUEUE_SIZE, broadcast, getClientIp, safeVisitorId, makeDualLimiter } = require('./_recommendations.shared');
const { validateString, validateInEnum, validateRecommendationBody } = require('../utils/validate');
const { REC_STATUS } = require('../constants/recommendation-status');
const { FILTER_ACTION, FILTER_STATUS } = require('../constants/music-filter-status');
const { PLATFORM, VALID_PLATFORMS, parseAllowedPlatforms, platformLabel } = require('../constants/platforms');
const { RECOMMENDATION_REQUEST_LIMIT, VOTE_LIMIT, COMMENT_LIMIT } = require('../constants/limits');

// 신청 한도는 두 차원으로 적용:
//  (1) visitor_id (클라이언트 localStorage UUID) — 같은 브라우저 식별
//  (2) IP — 헤더가 위조돼도 우회 불가한 최후 방어선
// visitor_id 헤더는 사용자가 매 요청마다 새로 생성해 위조할 수 있으므로
// 단독으로 쓰면 무력화됨. 둘 다 통과해야만 신청 허용.
const requestLimiters = makeDualLimiter({
  ...RECOMMENDATION_REQUEST_LIMIT,
  message: '잠시 후 다시 추천해주세요 (1분에 3곡 제한)',
});

// 투표·댓글도 익명 쓰기 API — 전역 분당 120에만 의존하면 도배 가능.
// 투표는 토글(추가/취소) UX상 신청보다 여유롭게, 댓글은 신청과 유사하게.
const voteLimiters = makeDualLimiter({
  ...VOTE_LIMIT,
  message: '잠시 후 다시 시도해주세요 (투표 한도 초과)',
});
const commentLimiters = makeDualLimiter({
  ...COMMENT_LIMIT,
  message: '잠시 후 다시 댓글을 남겨주세요 (1분에 5개 제한)',
});

function filterPayload(filterResult) {
  return {
    filterStatus: filterResult.filterStatus,
    filterReason: filterResult.reason,
    filterConfidence: filterResult.confidence,
    filterModel: filterResult.model,
    filterErrorCode: filterResult.errorCode,
  };
}

// GET /api/v1/cafes/:slug/recommendations
router.get('/', async (req, res) => {
  const cafe = await cafeService.findBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
  const recs = await recService.getRecommendations(cafe.id);

  // 방문 기록 (같은 IP는 KST 기준 하루 1회만 — UNIQUE 제약 + ON CONFLICT DO NOTHING)
  const ip        = getClientIp(req);
  const visitorId = req.headers['x-visitor-id'] || null;
  db('cafe_visits')
    .insert({
      cafe_id:    cafe.id,
      visitor_ip: ip,
      visitor_id: visitorId,
      visit_date: db.raw(`(now() AT TIME ZONE 'Asia/Seoul')::date`),
    })
    .onConflict(['cafe_id', 'visitor_ip', 'visit_date'])
    .ignore()
    .catch(() => {});

  const allowed_platforms = parseAllowedPlatforms(cafe.allowed_platforms);
  res.json({ recommendations: recs, is_accepting: cafe.is_accepting, notice: cafe.notice || null, cafe_name: cafe.name, allowed_platforms });
});

// POST /api/v1/cafes/:slug/recommendations  (손님 신청)
router.post('/', requestLimiters, async (req, res) => {
  const cafe = await cafeService.findBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
  if (!cafe.is_accepting) return res.status(403).json({ error: '현재 추천을 받지 않습니다' });

  const body = req.body || {};
  const bodyCheck = validateRecommendationBody(body);
  if (bodyCheck.error) return res.status(400).json({ error: bodyCheck.error });
  const platformCheck = validateInEnum(body.platform || PLATFORM.YOUTUBE, VALID_PLATFORMS, { name: 'platform' });
  if (platformCheck.error) return res.status(400).json({ error: platformCheck.error });
  const { videoId, title, channelTitle, thumbnail, duration, requesterName } = bodyCheck.value;
  const platform = platformCheck.value;

  const allowed = parseAllowedPlatforms(cafe.allowed_platforms);
  if (!allowed.includes(platform)) {
    return res.status(403).json({ error: `이 카페에서는 ${platformLabel(platform)} 신청을 받지 않습니다` });
  }

  const duplicate = await recService.findActiveByVideoId(cafe.id, videoId);
  if (duplicate) return res.status(409).json({ error: '이미 대기 중인 곡입니다' });

  const queueCount = await recService.countActive(cafe.id);
  if (queueCount >= MAX_QUEUE_SIZE)
    return res.status(429).json({ error: `대기열이 가득 찼습니다 (최대 ${MAX_QUEUE_SIZE}곡)` });

  const filterResult = await musicFilter.evaluateRecommendation({
    cafe,
    track: { videoId, title, channelTitle, thumbnail, duration, platform, requesterName },
  });

  const ip  = getClientIp(req);
  const visitorId = safeVisitorId(req);
  let rec;
  try {
    rec = await recService.add(cafe.id, {
      videoId,
      title,
      channelTitle,
      thumbnail,
      duration,
      requesterIp: ip,
      requesterName,
      platform,
      visitorId,
      status: filterResult.action === FILTER_ACTION.REJECT ? REC_STATUS.REJECTED : REC_STATUS.PENDING,
      ...filterPayload(filterResult),
    });
  } catch (err) {
    // partial unique index(018) — 사전 중복 체크와 insert 사이 race를 DB가 확정 차단
    if (err.code === '23505') return res.status(409).json({ error: '이미 대기 중인 곡입니다' });
    throw err;
  }

  if (filterResult.action === FILTER_ACTION.REJECT) {
    if (filterResult.filterStatus === FILTER_STATUS.ERROR_REJECTED) {
      broadcast(req, req.params.slug, 'music_filter_error', {
        title,
        platform,
        reason: filterResult.reason,
        errorCode: filterResult.errorCode,
        occurredAt: new Date().toISOString(),
      });
      return res.status(503).json({ error: 'AI 필터 확인 중 문제가 발생해 신청할 수 없습니다. 잠시 후 다시 시도해주세요.' });
    }

    return res.status(403).json({ error: '이 곡은 매장 분위기와 맞지 않아 신청할 수 없습니다.' });
  }

  broadcast(req, req.params.slug, 'recommendations_update', { action: 'add', rec });
  res.status(201).json(rec);
});

// GET /api/v1/cafes/:slug/recommendations/top10?offset=0
router.get('/top10', async (req, res) => {
  const cafe   = await cafeService.findBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
  const offset = parseInt(req.query.offset) || 0;
  res.json(await statsService.getCafeTop10(cafe.id, offset));
});

// DELETE /api/v1/cafes/:slug/recommendations/:id/cancel  (손님: 내 신청 취소)
router.delete('/:id/cancel', async (req, res) => {
  const rec = await recService.findById(req.params.id);
  if (!rec) return res.status(404).json({ error: '추천곡을 찾을 수 없습니다' });
  if (![REC_STATUS.PENDING, REC_STATUS.ACCEPTED].includes(rec.status))
    return res.status(409).json({ error: '이미 처리된 추천곡은 취소할 수 없습니다' });

  // 본인 신청만 취소 가능 — rec.id는 소켓으로 모든 손님에게 브로드캐스트되므로
  // ID만으로 삭제를 허용하면 남의 신청을 지울 수 있음. visitor_id(같은 브라우저)
  // 또는 requester_ip(같은 기기·NAT) 중 하나라도 일치해야 본인으로 간주.
  const ip        = getClientIp(req);
  const visitorId = safeVisitorId(req);
  const isOwner =
    (rec.visitor_id && visitorId && rec.visitor_id === visitorId) ||
    (rec.requester_ip && rec.requester_ip === ip);
  if (!isOwner) return res.status(403).json({ error: '본인이 신청한 곡만 취소할 수 있습니다' });

  await recService.remove(rec.id);
  broadcast(req, req.params.slug, 'recommendations_update', { action: 'delete', id: rec.id });
  res.json({ ok: true });
});

// POST /api/v1/cafes/:slug/recommendations/:id/vote
router.post('/:id/vote', voteLimiters, async (req, res) => {
  const ip = getClientIp(req);
  const visitorId = req.headers['x-visitor-id'] || null;
  try {
    const rec = await recService.vote(req.params.id, ip, visitorId);
    broadcast(req, req.params.slug, 'recommendations_update', { action: 'vote', rec });
    res.json(rec);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '이미 투표했습니다' });
    throw err;
  }
});

// DELETE /api/v1/cafes/:slug/recommendations/:id/vote
router.delete('/:id/vote', voteLimiters, async (req, res) => {
  const ip = getClientIp(req);
  const rec = await recService.unvote(req.params.id, ip);
  broadcast(req, req.params.slug, 'recommendations_update', { action: 'vote', rec });
  res.json(rec);
});

// POST /api/v1/cafes/:slug/recommendations/:id/comments
router.post('/:id/comments', commentLimiters, async (req, res) => {
  const bodyCheck = validateString(req.body?.body, { max: 200, name: 'body' });
  if (bodyCheck.error) return res.status(400).json({ error: bodyCheck.error });
  const nameCheck = validateString(req.body?.commenterName, { max: 50, allowNull: true, name: 'commenterName' });
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });
  const ip      = getClientIp(req);
  const comment = await recService.addComment(req.params.id, { commenterIp: ip, commenterName: nameCheck.value, body: bodyCheck.value });
  broadcast(req, req.params.slug, 'comment_added', { recommendationId: req.params.id, comment });
  res.status(201).json(comment);
});

module.exports = router;
