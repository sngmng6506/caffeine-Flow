const router    = require('express').Router({ mergeParams: true });
const rateLimit = require('express-rate-limit');
const { requireAuth, requireCafeOwner } = require('../middleware/auth');
const cafeService = require('../services/cafe.service');
const recService  = require('../services/recommendation.service');

const requestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { error: '잠시 후 다시 신청해주세요 (1분에 3곡 제한)' },
});

function broadcast(req, slug, event, data) {
  req.app.get('io')?.of('/cafe').to(slug).emit(event, data);
}

// GET /api/v1/cafes/:slug/recommendations
router.get('/', async (req, res) => {
  const cafe = await cafeService.findBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
  const recs = await recService.getRecommendations(cafe.id);
  res.json({ recommendations: recs, is_accepting: cafe.is_accepting });
});

// POST /api/v1/cafes/:slug/recommendations  (손님 신청)
router.post('/', requestLimiter, async (req, res) => {
  const cafe = await cafeService.findBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
  if (!cafe.is_accepting) return res.status(403).json({ error: '현재 신청을 받지 않습니다' });

  const { videoId, title, channelTitle, thumbnail, duration, requesterName } = req.body;
  if (!videoId || !title) return res.status(400).json({ error: 'videoId, title 필수' });

  const ip  = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  const rec = await recService.add(cafe.id, { videoId, title, channelTitle, thumbnail, duration, requesterIp: ip, requesterName });

  broadcast(req, req.params.slug, 'recommendations_update', { action: 'add', rec });
  res.status(201).json(rec);
});

// PUT /api/v1/cafes/:slug/recommendations/:id  (사장님: 상태 변경)
router.put('/:id', requireAuth, requireCafeOwner, async (req, res) => {
  const { status } = req.body;
  const valid = ['accepted', 'rejected', 'playing', 'played', 'skipped'];
  if (!valid.includes(status)) return res.status(400).json({ error: '유효하지 않은 status' });

  const rec = await recService.updateStatus(req.params.id, status);
  broadcast(req, req.params.slug, 'recommendations_update', { action: 'update', rec });
  res.json(rec);
});

// DELETE /api/v1/cafes/:slug/recommendations/:id  (사장님)
router.delete('/:id', requireAuth, requireCafeOwner, async (req, res) => {
  await recService.remove(req.params.id);
  broadcast(req, req.params.slug, 'recommendations_update', { action: 'delete', id: req.params.id });
  res.json({ ok: true });
});

// POST /api/v1/cafes/:slug/recommendations/:id/vote
router.post('/:id/vote', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  try {
    const rec = await recService.vote(req.params.id, ip);
    broadcast(req, req.params.slug, 'recommendations_update', { action: 'vote', rec });
    res.json(rec);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '이미 투표했습니다' });
    throw err;
  }
});

// POST /api/v1/cafes/:slug/recommendations/:id/comments
router.post('/:id/comments', async (req, res) => {
  const { commenterName, body } = req.body;
  if (!body) return res.status(400).json({ error: 'body 필수' });
  const ip      = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  const comment = await recService.addComment(req.params.id, { commenterIp: ip, commenterName, body });
  broadcast(req, req.params.slug, 'comment_added', { recommendationId: req.params.id, comment });
  res.status(201).json(comment);
});

module.exports = router;
