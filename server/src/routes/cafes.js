const router = require('express').Router();
const { requireAuth }  = require('../middleware/auth');
const cafeService      = require('../services/cafe.service');
const statsService = require('../services/stats.service');
const { safeCafe } = require('../utils/cafe-sanitize');
const { APP_URL } = require('../config');
const { validateString, validateBool, validateInEnum } = require('../utils/validate');
const db = require('../db/knex');
const { kstStartOfDateString, kstEndOfDateString } = require('../utils/kst');

// GET /api/v1/cafes/me
router.get('/me', requireAuth, async (req, res) => {
  const cafe = await cafeService.findBySlug(req.owner.slug);
  if (!cafe) return res.status(404).json({ error: 'Not found' });
  const baseUrl = APP_URL || req.app.get('baseUrl') || `${req.protocol}://${req.get('host')}`;
  res.json({ ...safeCafe(cafe), customer_url: `${baseUrl}/${cafe.slug}` });
});

// PUT /api/v1/cafes/me
router.put('/me', requireAuth, async (req, res) => {
  const nameCheck = validateString(req.body?.name, { max: 100, name: '카페명' });
  if (nameCheck.error) return res.status(400).json({ error: nameCheck.error });
  const cafe = await cafeService.update(req.owner.cafeId, { name: nameCheck.value });
  req.app.get('io')?.of('/cafe').to(cafe.slug).emit('cafe_updated', { cafe_name: cafe.name });
  res.json(safeCafe(cafe));
});

// PUT /api/v1/cafes/me/notice
router.put('/me/notice', requireAuth, async (req, res) => {
  const noticeCheck = validateString(req.body?.notice, { max: 500, allowNull: true, name: '공지' });
  if (noticeCheck.error) return res.status(400).json({ error: noticeCheck.error });
  const cafe = await cafeService.update(req.owner.cafeId, { notice: noticeCheck.value });
  req.app.get('io')?.of('/cafe').to(cafe.slug).emit('notice_updated', { notice: cafe.notice });
  res.json({ notice: cafe.notice });
});

// PUT /api/v1/cafes/me/platforms  (허용 플랫폼 설정)
router.put('/me/platforms', requireAuth, async (req, res) => {
  const { allowed_platforms } = req.body;
  if (!Array.isArray(allowed_platforms) || allowed_platforms.length === 0) {
    return res.status(400).json({ error: '최소 1개 플랫폼을 선택해주세요' });
  }
  const valid = ['youtube', 'soundcloud', 'spotify'];
  const filtered = allowed_platforms.filter(p => valid.includes(p));
  if (filtered.length === 0) return res.status(400).json({ error: '유효한 플랫폼이 없습니다' });

  const cafe = await cafeService.update(req.owner.cafeId, { allowed_platforms: filtered.join(',') });
  req.app.get('io')?.of('/cafe').to(cafe.slug).emit('platforms_updated', { allowed_platforms: filtered });
  res.json({ allowed_platforms: filtered });
});

// PUT /api/v1/cafes/me/music-filter  (AI 음악 필터 설정)
router.put('/me/music-filter', requireAuth, async (req, res) => {
  const enabledCheck = validateBool(req.body?.enabled, { name: 'enabled' });
  if (enabledCheck.error) return res.status(400).json({ error: enabledCheck.error });

  const promptCheck = validateString(req.body?.prompt, { max: 1000, allowNull: true, name: 'AI 필터 프롬프트' });
  if (promptCheck.error) return res.status(400).json({ error: promptCheck.error });

  const strictnessCheck = validateInEnum(req.body?.strictness || 'medium', ['low', 'medium', 'high'], { name: 'strictness' });
  if (strictnessCheck.error) return res.status(400).json({ error: strictnessCheck.error });

  if (enabledCheck.value && !promptCheck.value) {
    return res.status(400).json({ error: 'AI 필터를 켜려면 매장 분위기 설명을 입력해주세요' });
  }

  const cafe = await cafeService.update(req.owner.cafeId, {
    music_filter_enabled: enabledCheck.value,
    music_filter_prompt: promptCheck.value,
    music_filter_strictness: strictnessCheck.value,
  });

  res.json({
    music_filter_enabled: cafe.music_filter_enabled,
    music_filter_prompt: cafe.music_filter_prompt,
    music_filter_strictness: cafe.music_filter_strictness,
  });
});

// PUT /api/v1/cafes/me/address  (주소 변경)
router.put('/me/address', requireAuth, async (req, res) => {
  const { address, roadAddress, region, district, latitude, longitude } = req.body;
  if (!address && !roadAddress) return res.status(400).json({ error: '주소를 입력해주세요' });
  const cafe = await cafeService.update(req.owner.cafeId, {
    address:      address      || null,
    road_address: roadAddress  || null,
    region:       region       || null,
    district:     district     || null,
    latitude:     latitude     || null,
    longitude:    longitude    || null,
  });
  res.json({ address: cafe.address, road_address: cafe.road_address, region: cafe.region, district: cafe.district, latitude: cafe.latitude, longitude: cafe.longitude });
});

// PUT /api/v1/cafes/me/status  (신청 ON/OFF 토글)
router.put('/me/status', requireAuth, async (req, res) => {
  const check = validateBool(req.body?.is_accepting, { name: 'is_accepting' });
  if (check.error) return res.status(400).json({ error: check.error });
  const cafe = await cafeService.update(req.owner.cafeId, { is_accepting: check.value });
  req.app.get('io')?.of('/cafe').to(cafe.slug).emit('system_toggled', { is_accepting: cafe.is_accepting });
  res.json({ is_accepting: cafe.is_accepting });
});

// GET /api/v1/cafes/me/history?offset=0&date=YYYY-MM-DD
router.get('/me/history', requireAuth, async (req, res) => {
  const offset = parseInt(req.query.offset) || 0;
  const limit  = 20;
  let query = db('recommendations')
    .where({ cafe_id: req.owner.cafeId })
    .whereIn('status', ['played', 'skipped', 'rejected'])
    .orderBy('requested_at', 'desc');

  if (req.query.date) {
    // KST 경계 사용 — UTC 자정 기준이면 KST 09:00~다음날 08:59가 잡혀
    // 통계 탭(KST 기준)과 이력 날짜 필터가 서로 다른 하루를 보게 됨
    const start = kstStartOfDateString(req.query.date);
    const end   = kstEndOfDateString(req.query.date);
    query = query.whereBetween('requested_at', [start, end]);
  }

  const items = await query.limit(limit + 1).offset(offset);
  res.json({ items: items.slice(0, limit), hasMore: items.length > limit });
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

// GET /api/v1/cafes/me/stats/hourly-songs?hour=0&offset=0  (해당 시간대 신청곡, 최근 30일)
router.get('/me/stats/hourly-songs', requireAuth, async (req, res) => {
  const hour = parseInt(req.query.hour);
  if (isNaN(hour) || hour < 0 || hour > 23) return res.status(400).json({ error: 'hour는 0~23' });
  const offset = parseInt(req.query.offset) || 0;
  res.json(await statsService.getSongsByHour(req.owner.cafeId, hour, offset));
});

// GET /api/v1/cafes/me/stats/weekday-songs?day=0&offset=0  (해당 요일 신청곡, 최근 30일)
router.get('/me/stats/weekday-songs', requireAuth, async (req, res) => {
  const day = parseInt(req.query.day);
  if (isNaN(day) || day < 0 || day > 6) return res.status(400).json({ error: 'day는 0~6' });
  const offset = parseInt(req.query.offset) || 0;
  res.json(await statsService.getSongsByWeekday(req.owner.cafeId, day, offset));
});

module.exports = router;
