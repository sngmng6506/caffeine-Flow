const router      = require('express').Router({ mergeParams: true });
const cafeService = require('../services/cafe.service');
const svc         = require('../services/song_comments.service');
const { validateString, isUuid } = require('../utils/validate');
const { getClientIp, safeVisitorId, makeDualLimiter } = require('./_recommendations.shared');
const { COMMENT_LIMIT, COMMENT_PAGE_SIZE, COMMENT_PAGE_MAX_SIZE } = require('../constants/limits');
const { parseLimit, parseOffset } = require('../utils/pagination');

const commentLimiters = makeDualLimiter({ ...COMMENT_LIMIT, message: '잠시 후 다시 댓글을 남겨주세요 (1분에 5개 제한)' });

// 카페 경로로 접근하면 활성 카페를 반드시 확인한다. 잘못된 slug를
// cafe_id=null인 전역 댓글로 조용히 바꾸지 않는다.
router.use(async (req, res, next) => {
  const videoIdCheck = validateString(req.params.videoId, { max: 1000, name: 'videoId' });
  if (videoIdCheck.error) return res.status(400).json({ error: videoIdCheck.error });
  req.commentVideoId = videoIdCheck.value;
  if (!req.params.slug) {
    req.commentCafeId = null;
    return next();
  }
  const cafe = await cafeService.findActiveBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
  req.commentCafeId = cafe.id;
  next();
});

// GET  /api/v1/cafes/:slug/songs/:videoId/comments
// GET  /api/v1/songs/:videoId/comments
router.get('/', async (req, res) => {
  const offset = parseOffset(req.query.offset);
  if (offset.error) return res.status(400).json({ error: offset.error });
  const limit = parseLimit(req.query.limit, {
    defaultValue: COMMENT_PAGE_SIZE,
    max: COMMENT_PAGE_MAX_SIZE,
  });
  if (limit.error) return res.status(400).json({ error: limit.error });

  res.json(await svc.getComments(req.commentVideoId, {
    offset: offset.value,
    limit: limit.value,
  }));
});

// POST /api/v1/cafes/:slug/songs/:videoId/comments
// POST /api/v1/songs/:videoId/comments
router.post('/', commentLimiters, async (req, res) => {
  const bodyCheck = validateString(req.body?.body, { max: 200, name: 'body' });
  if (bodyCheck.error) return res.status(400).json({ error: bodyCheck.error });
  const nameCheck = validateString(req.body?.commenterName, { max: 50, allowNull: true, name: 'commenterName' });
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });

  const comment = await svc.addComment(req.commentVideoId, req.commentCafeId, {
    commenterIp:   getClientIp(req),
    commenterName: nameCheck.value || undefined,
    body:          bodyCheck.value,
    visitorId:     safeVisitorId(req),
  });
  res.status(201).json(comment);
});

// POST /api/v1/cafes/:slug/songs/:videoId/comments/:commentId/replies
// POST /api/v1/songs/:videoId/comments/:commentId/replies
router.post('/:commentId/replies', commentLimiters, async (req, res) => {
  if (!isUuid(req.params.commentId)) return res.status(400).json({ error: '댓글 ID 형식 오류' });
  const bodyCheck = validateString(req.body?.body, { max: 200, name: 'body' });
  if (bodyCheck.error) return res.status(400).json({ error: bodyCheck.error });
  const nameCheck = validateString(req.body?.commenterName, { max: 50, allowNull: true, name: 'commenterName' });
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });

  try {
    const reply = await svc.addReply(req.commentVideoId, req.params.commentId, req.commentCafeId, {
      commenterIp:   getClientIp(req),
      commenterName: nameCheck.value || undefined,
      body:          bodyCheck.value,
      visitorId:     safeVisitorId(req),
    });
    res.status(201).json(reply);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

module.exports = router;
