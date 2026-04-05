const router = require('express').Router();
const { requireAuth }  = require('../middleware/auth');
const cafeService      = require('../services/cafe.service');
const statsService = require('../services/stats.service');

function safeCafe(cafe) {
  const { password_hash, ...rest } = cafe;
  return rest;
}

// GET /api/v1/cafes/me
router.get('/me', requireAuth, async (req, res) => {
  const cafe = await cafeService.findBySlug(req.owner.slug);
  if (!cafe) return res.status(404).json({ error: 'Not found' });
  res.json(safeCafe(cafe));
});

// PUT /api/v1/cafes/me
router.put('/me', requireAuth, async (req, res) => {
  const { name } = req.body;
  const cafe = await cafeService.update(req.owner.cafeId, { name });
  res.json(safeCafe(cafe));
});

// PUT /api/v1/cafes/me/notice
router.put('/me/notice', requireAuth, async (req, res) => {
  const { notice } = req.body;
  const cafe = await cafeService.update(req.owner.cafeId, { notice: notice?.trim() || null });
  req.app.get('io')?.of('/cafe').to(cafe.slug).emit('notice_updated', { notice: cafe.notice });
  res.json({ notice: cafe.notice });
});

// PUT /api/v1/cafes/me/status  (신청 ON/OFF 토글)
router.put('/me/status', requireAuth, async (req, res) => {
  const { is_accepting } = req.body;
  const cafe = await cafeService.update(req.owner.cafeId, { is_accepting });
  res.json({ is_accepting: cafe.is_accepting });
});

// GET /api/v1/cafes/me/stats
router.get('/me/stats', requireAuth, async (req, res) => {
  res.json(await statsService.getStats(req.owner.cafeId));
});

// GET /api/v1/cafes/me/stats/daily?date=YYYY-MM-DD
router.get('/me/stats/daily', requireAuth, async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  res.json(await statsService.getDailyStats(req.owner.cafeId, date));
});

// GET /api/v1/cafes/me/stats/hourly  (최근 30일 시간대별 패턴)
router.get('/me/stats/hourly', requireAuth, async (req, res) => {
  res.json(await statsService.getHourlyPattern(req.owner.cafeId));
});

// GET /api/v1/cafes/me/stats/weekday  (최근 30일 요일별 패턴)
router.get('/me/stats/weekday', requireAuth, async (req, res) => {
  res.json(await statsService.getDayOfWeekPattern(req.owner.cafeId));
});

// GET /api/v1/cafes/me/stats/weekday-songs?day=0  (해당 요일 신청곡)
router.get('/me/stats/weekday-songs', requireAuth, async (req, res) => {
  const day = parseInt(req.query.day);
  if (isNaN(day) || day < 0 || day > 6) return res.status(400).json({ error: 'day는 0~6' });
  res.json(await statsService.getSongsByWeekday(req.owner.cafeId, day));
});

module.exports = router;
