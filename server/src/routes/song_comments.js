const router      = require('express').Router({ mergeParams: true });
const cafeService = require('../services/cafe.service');
const svc         = require('../services/song_comments.service');
const { validateString } = require('../utils/validate');
const { getClientIp, safeVisitorId, makeDualLimiter } = require('./_recommendations.shared');

const commentLimiters = makeDualLimiter({ visitorMax: 5, ipMax: 15, message: '잠시 후 다시 댓글을 남겨주세요 (1분에 5개 제한)' });

// 카페 경로로 접근하면 활성 카페를 반드시 확인한다. 잘못된 slug를
// cafe_id=null인 전역 댓글로 조용히 바꾸지 않는다.
router.use(async (req, res, next) => {
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
  res.json(await svc.getComments(req.params.videoId));
});

// POST /api/v1/cafes/:slug/songs/:videoId/comments
// POST /api/v1/songs/:videoId/comments
router.post('/', commentLimiters, async (req, res) => {
  const bodyCheck = validateString(req.body?.body, { max: 200, name: 'body' });
  if (bodyCheck.error) return res.status(400).json({ error: bodyCheck.error });
  const nameCheck = validateString(req.body?.commenterName, { max: 50, allowNull: true, name: 'commenterName' });
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });

  const comment = await svc.addComment(req.params.videoId, req.commentCafeId, {
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
  const bodyCheck = validateString(req.body?.body, { max: 200, name: 'body' });
  if (bodyCheck.error) return res.status(400).json({ error: bodyCheck.error });
  const nameCheck = validateString(req.body?.commenterName, { max: 50, allowNull: true, name: 'commenterName' });
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });

  try {
    const reply = await svc.addReply(req.params.videoId, req.params.commentId, req.commentCafeId, {
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
