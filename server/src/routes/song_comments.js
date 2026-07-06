const router      = require('express').Router({ mergeParams: true });
const cafeService = require('../services/cafe.service');
const svc         = require('../services/song_comments.service');
const { validateString } = require('../utils/validate');
const { getClientIp, safeVisitorId } = require('./_recommendations.shared');

// GET  /api/v1/cafes/:slug/songs/:videoId/comments
// GET  /api/v1/songs/:videoId/comments
router.get('/', async (req, res) => {
  res.json(await svc.getComments(req.params.videoId));
});

// POST /api/v1/cafes/:slug/songs/:videoId/comments
// POST /api/v1/songs/:videoId/comments
router.post('/', async (req, res) => {
  const bodyCheck = validateString(req.body?.body, { max: 200, name: 'body' });
  if (bodyCheck.error) return res.status(400).json({ error: bodyCheck.error });
  const nameCheck = validateString(req.body?.commenterName, { max: 50, allowNull: true, name: 'commenterName' });
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });

  const cafeId = await resolveCafeId(req);
  const comment = await svc.addComment(req.params.videoId, cafeId, {
    commenterIp:   getClientIp(req),
    commenterName: nameCheck.value || undefined,
    body:          bodyCheck.value,
    visitorId:     safeVisitorId(req),
  });
  res.status(201).json(comment);
});

// POST /api/v1/cafes/:slug/songs/:videoId/comments/:commentId/replies
// POST /api/v1/songs/:videoId/comments/:commentId/replies
router.post('/:commentId/replies', async (req, res) => {
  const bodyCheck = validateString(req.body?.body, { max: 200, name: 'body' });
  if (bodyCheck.error) return res.status(400).json({ error: bodyCheck.error });
  const nameCheck = validateString(req.body?.commenterName, { max: 50, allowNull: true, name: 'commenterName' });
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });

  const cafeId = await resolveCafeId(req);
  const reply = await svc.addReply(req.params.commentId, cafeId, {
    commenterIp:   getClientIp(req),
    commenterName: nameCheck.value || undefined,
    body:          bodyCheck.value,
    visitorId:     safeVisitorId(req),
  });
  res.status(201).json(reply);
});

async function resolveCafeId(req) {
  if (!req.params.slug) return null;
  const cafe = await cafeService.findBySlug(req.params.slug);
  return cafe?.id ?? null;
}

module.exports = router;
