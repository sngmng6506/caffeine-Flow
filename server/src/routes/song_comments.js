const router      = require('express').Router({ mergeParams: true });
const cafeService = require('../services/cafe.service');
const svc         = require('../services/song_comments.service');

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
}

// GET  /api/v1/cafes/:slug/songs/:videoId/comments
// GET  /api/v1/songs/:videoId/comments
router.get('/', async (req, res) => {
  res.json(await svc.getComments(req.params.videoId));
});

// POST /api/v1/cafes/:slug/songs/:videoId/comments
// POST /api/v1/songs/:videoId/comments
router.post('/', async (req, res) => {
  const { commenterName, body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'body 필수' });

  const cafeId = await resolveCafeId(req);
  const visitorId = req.headers['x-visitor-id'] || null;
  const comment = await svc.addComment(req.params.videoId, cafeId, {
    commenterIp:   getIp(req),
    commenterName: commenterName || undefined,
    body:          body.trim(),
    visitorId,
  });
  res.status(201).json(comment);
});

// POST /api/v1/cafes/:slug/songs/:videoId/comments/:commentId/replies
// POST /api/v1/songs/:videoId/comments/:commentId/replies
router.post('/:commentId/replies', async (req, res) => {
  const { commenterName, body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'body 필수' });

  const cafeId = await resolveCafeId(req);
  const visitorId = req.headers['x-visitor-id'] || null;
  const reply = await svc.addReply(req.params.commentId, cafeId, {
    commenterIp:   getIp(req),
    commenterName: commenterName || undefined,
    body:          body.trim(),
    visitorId,
  });
  res.status(201).json(reply);
});

async function resolveCafeId(req) {
  if (!req.params.slug) return null;
  const cafe = await cafeService.findBySlug(req.params.slug);
  return cafe?.id ?? null;
}

module.exports = router;
