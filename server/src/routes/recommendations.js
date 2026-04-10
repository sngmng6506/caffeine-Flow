const router    = require('express').Router({ mergeParams: true });
const rateLimit = require('express-rate-limit');
const { requireAuth, requireCafeOwner } = require('../middleware/auth');
const cafeService   = require('../services/cafe.service');
const recService    = require('../services/recommendation.service');
const statsService  = require('../services/stats.service');

const requestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { error: '잠시 후 다시 추천해주세요 (1분에 3곡 제한)' },
});

const MAX_QUEUE_SIZE = 30;

function broadcast(req, slug, event, data) {
  req.app.get('io')?.of('/cafe').to(slug).emit(event, data);
}

// GET /api/v1/cafes/:slug/recommendations
router.get('/', async (req, res) => {
  const cafe = await cafeService.findBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
  const recs = await recService.getRecommendations(cafe.id);

  // 방문 기록 (같은 IP는 하루 1회만)
  const ip    = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const db    = require('../db/knex');
  db('cafe_visits')
    .where({ cafe_id: cafe.id, visitor_ip: ip })
    .where('visited_at', '>=', today)
    .first()
    .then(existing => {
      if (!existing) db('cafe_visits').insert({ cafe_id: cafe.id, visitor_ip: ip }).catch(() => {});
    })
    .catch(() => {});

  res.json({ recommendations: recs, is_accepting: cafe.is_accepting, notice: cafe.notice || null, cafe_name: cafe.name });
});

// POST /api/v1/cafes/:slug/recommendations  (손님 신청)
router.post('/', requestLimiter, async (req, res) => {
  const cafe = await cafeService.findBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });
  if (!cafe.is_accepting) return res.status(403).json({ error: '현재 추천을 받지 않습니다' });

  const { videoId, title, channelTitle, thumbnail, duration, requesterName } = req.body;
  if (!videoId || !title) return res.status(400).json({ error: 'videoId, title 필수' });

  const duplicate = await recService.findActiveByVideoId(cafe.id, videoId);
  if (duplicate) return res.status(409).json({ error: '이미 대기 중인 곡입니다' });

  const queueCount = await recService.countActive(cafe.id);
  if (queueCount >= MAX_QUEUE_SIZE)
    return res.status(429).json({ error: `대기열이 가득 찼습니다 (최대 ${MAX_QUEUE_SIZE}곡)` });

  const ip  = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  const rec = await recService.add(cafe.id, { videoId, title, channelTitle, thumbnail, duration, requesterIp: ip, requesterName });

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
  if (!['pending', 'accepted'].includes(rec.status))
    return res.status(409).json({ error: '이미 처리된 추천곡은 취소할 수 없습니다' });

  await recService.remove(rec.id);
  broadcast(req, req.params.slug, 'recommendations_update', { action: 'delete', id: rec.id });
  res.json({ ok: true });
});

// POST /api/v1/cafes/:slug/recommendations/owner  (사장님: 직접 추가)
router.post('/owner', requireAuth, requireCafeOwner, async (req, res) => {
  const cafe = await cafeService.findBySlug(req.params.slug);
  if (!cafe) return res.status(404).json({ error: 'Cafe not found' });

  const { videoId, title, channelTitle, thumbnail, duration, status } = req.body;
  if (!videoId || !title) return res.status(400).json({ error: 'videoId, title 필수' });

  const validStatuses = ['pending', 'accepted', 'playing'];
  const recStatus = validStatuses.includes(status) ? status : 'pending';

  const rec = await recService.add(cafe.id, { videoId, title, channelTitle, thumbnail, duration, requesterIp: '127.0.0.1', requesterName: null });
  const updated = recStatus !== 'pending' ? await recService.updateStatus(rec.id, recStatus) : rec;

  broadcast(req, req.params.slug, 'recommendations_update', { action: 'add', rec: updated });
  res.status(201).json(updated);
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

// DELETE /api/v1/cafes/:slug/recommendations/:id/vote
router.delete('/:id/vote', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  const rec = await recService.unvote(req.params.id, ip);
  broadcast(req, req.params.slug, 'recommendations_update', { action: 'vote', rec });
  res.json(rec);
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
